const express = require('express');
const crypto = require('crypto');
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const ConfigManager = require('./config-manager');
const ServiceNowClient = require('./servicenow-client');
const IncidentIOClient = require('./incident-io-client');
const IncidentHandler = require('./incident-handler');
const FieldMapper = require('./field-mapper');
const ReverseSyncHandler = require('./reverse-sync-handler');

class App {
  constructor() {
    this.express = express();
    this.config = null;
    this.logger = null;
    this.serviceNowClient = null;
    this.incidentIOClient = null;
    this.incidentHandler = null;
    this.fieldMapper = null;
    this.reverseSyncHandler = null;
  }

  async initialize() {
    // Load configuration
    this.config = new ConfigManager();
    await this.config.load();

    // Setup logging
    this.setupLogging();

    // Initialize clients
    this.serviceNowClient = new ServiceNowClient(this.config.servicenow, this.logger);
    this.incidentIOClient = new IncidentIOClient(this.config.incident_io, this.logger);
    this.fieldMapper = new FieldMapper(this.config.field_mappings, this.logger);
    this.incidentHandler = new IncidentHandler(
      this.serviceNowClient,
      this.incidentIOClient,
      this.fieldMapper,
      this.config,
      this.logger
    );
    this.reverseSyncHandler = new ReverseSyncHandler(
      this.serviceNowClient,
      this.incidentIOClient,
      this.config,
      this.logger
    );

    // Setup Express middleware
    this.setupMiddleware();

    // Setup routes
    this.setupRoutes();

    // Setup error handling
    this.setupErrorHandling();

    this.logger.info('Application initialized successfully');
  }

  setupLogging() {
    const logFormat = this.config.logging.format === 'json' 
      ? winston.format.json()
      : winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
          })
        );

    this.logger = winston.createLogger({
      level: this.config.logging.level || 'info',
      format: logFormat,
      transports: [
        new winston.transports.Console(),
        ...(this.config.logging.file 
          ? [new winston.transports.File({ filename: this.config.logging.file })]
          : []
        )
      ]
    });
  }

  setupMiddleware() {
    // Security middleware
    this.express.use(helmet());

    // Rate limiting
    if (this.config.performance?.rate_limit) {
      const limiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: this.config.performance.rate_limit.requests_per_minute || 60,
        message: 'Too many requests from this IP, please try again later.',
        standardHeaders: true,
        legacyHeaders: false,
      });
      this.express.use(limiter);
    }

    // Body parsing middleware
    this.express.use('/webhook', express.raw({ type: 'application/json' }));
    this.express.use(express.json());

    // Request logging
    this.express.use((req, res, next) => {
      this.logger.info('Incoming request', {
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
      next();
    });
  }

  setupRoutes() {
    // Health check endpoint
    this.express.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        config: {
          servicenow_instance: this.config.servicenow.instance_url,
          incident_io_api: this.config.incident_io.api_url,
          features: this.config.features
        }
      });
    });

    // Main webhook endpoint
    this.express.post(this.config.webhook.path || '/webhook', async (req, res) => {
      try {
        // Verify webhook signature if enabled
        if (this.config.webhook.verify_signature) {
          if (!this.verifyWebhookSignature(req)) {
            this.logger.warn('Invalid webhook signature', { ip: req.ip });
            return res.status(401).json({ error: 'Invalid signature' });
          }
        }

        const payload = JSON.parse(req.body);
        this.logger.info('Received webhook', { 
          event_type: payload.event_type,
          incident_id: payload.data?.incident?.id 
        });

        // Route to appropriate handler
        await this.routeWebhookEvent(payload);

        res.status(200).json({ success: true });
      } catch (error) {
        this.logger.error('Webhook processing error', { 
          error: error.message,
          stack: error.stack 
        });
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Manual sync endpoint for testing
    this.express.post('/sync/incident/:incidentId', async (req, res) => {
      try {
        const { incidentId } = req.params;
        const { action = 'update' } = req.body;

        this.logger.info('Manual sync requested', { incidentId, action });

        if (action === 'create') {
          await this.incidentHandler.createIncident(incidentId);
        } else {
          await this.incidentHandler.updateIncident(incidentId);
        }

        res.json({ success: true, message: `Incident ${action} completed` });
      } catch (error) {
        this.logger.error('Manual sync error', { 
          error: error.message,
          incidentId: req.params.incidentId 
        });
        res.status(500).json({ error: error.message });
      }
    });

    // ServiceNow webhook endpoint for reverse sync
    this.express.post('/webhook/servicenow', async (req, res) => {
      try {
        // Verify ServiceNow signature if enabled
        if (this.config.servicenow_webhook?.verify_signature && this.config.servicenow_webhook?.secret) {
          if (!this.verifyServiceNowSignature(req)) {
            this.logger.warn('Invalid ServiceNow webhook signature', { ip: req.ip });
            return res.status(401).json({ error: 'Invalid signature' });
          }
        }

        const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        this.logger.info('Received ServiceNow webhook', { 
          sys_id: payload.sys_id,
          table: payload.table,
          operation: payload.operation,
          updated_fields: payload.updated_fields
        });

        // Only process incident table updates
        if (payload.table !== (this.config.servicenow.table || 'incident')) {
          this.logger.debug('Ignoring non-incident table update', { table: payload.table });
          return res.status(200).json({ success: true, message: 'Ignored non-incident update' });
        }

        // Only process updates (not inserts/deletes)
        if (payload.operation !== 'update') {
          this.logger.debug('Ignoring non-update operation', { operation: payload.operation });
          return res.status(200).json({ success: true, message: 'Ignored non-update operation' });
        }

        // Handle the ServiceNow update
        await this.reverseSyncHandler.handleServiceNowUpdate(
          payload.sys_id,
          payload.updated_fields || [],
          payload.old_values || {}
        );

        res.status(200).json({ success: true });
      } catch (error) {
        this.logger.error('ServiceNow webhook processing error', { 
          error: error.message,
          stack: error.stack 
        });
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Manual reverse sync endpoint for testing
    this.express.post('/sync/servicenow/:sysId', async (req, res) => {
      try {
        const { sysId } = req.params;
        const { updated_fields = [], old_values = {} } = req.body;

        this.logger.info('Manual reverse sync requested', { 
          sys_id: sysId,
          updated_fields
        });

        await this.reverseSyncHandler.handleServiceNowUpdate(sysId, updated_fields, old_values);

        res.json({ success: true, message: 'Reverse sync completed' });
      } catch (error) {
        this.logger.error('Manual reverse sync error', { 
          error: error.message,
          sysId: req.params.sysId 
        });
        res.status(500).json({ error: error.message });
      }
    });
  }

  verifyWebhookSignature(req) {
    const signature = req.get('X-Incident-Signature');
    if (!signature) return false;

    const expectedSignature = crypto
      .createHmac('sha256', this.config.webhook.secret)
      .update(req.body)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(`sha256=${expectedSignature}`),
      Buffer.from(signature)
    );
  }

  verifyServiceNowSignature(req) {
    const signature = req.get('X-ServiceNow-Signature');
    if (!signature) return false;

    const expectedSignature = crypto
      .createHmac('sha256', this.config.servicenow_webhook.secret)
      .update(req.body)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(`sha256=${expectedSignature}`),
      Buffer.from(signature)
    );
  }

  async routeWebhookEvent(payload) {
    const eventType = payload.event_type;
    
    // Handle different payload structures for different event types
    let incident, eventData;
    if (eventType === 'public_incident.incident_status_updated_v2') {
      // Status update events have a different structure: { incident, new_status, previous_status }
      eventData = payload[eventType];
      incident = eventData?.incident;
    } else {
      // Regular incident events: payload[event_type] contains the incident data directly
      eventData = payload[eventType];
      incident = eventData;
    }

    // Debug: Log the payload structure to understand incident.io webhook format
    this.logger.debug('Webhook payload structure', { 
      event_type: eventType,
      payload_keys: Object.keys(payload),
      has_event_data: !!eventData,
      has_incident: !!incident,
      incident_keys: incident ? Object.keys(incident) : null,
      incident_status_name: incident?.incident_status?.name,
      incident_severity_name: incident?.severity?.name,
      incident_data: incident ? JSON.stringify(incident, null, 2) : null
    });

    if (!incident) {
      this.logger.warn('No incident data in webhook payload', { 
        event_type: eventType,
        payload_keys: Object.keys(payload),
        has_event_data: !!eventData
      });
      return;
    }

    switch (eventType) {
      case 'public_incident.incident_created_v2':
        if (this.config.features.create_incidents) {
          await this.incidentHandler.createIncident(incident.id, payload);
        } else {
          this.logger.info('Incident creation disabled, skipping', { incident_id: incident.id });
        }
        break;

      case 'public_incident.incident_updated_v2':
      case 'public_incident.incident_status_updated_v2':
        if (this.config.features.update_incidents) {
          await this.incidentHandler.updateIncident(incident.id, payload);
        } else {
          this.logger.info('Incident updates disabled, skipping', { incident_id: incident.id });
        }
        break;

      default:
        this.logger.warn('Unhandled event type', { 
          event_type: eventType, 
          payload_keys: Object.keys(payload),
          payload_data_keys: payload[eventType] ? Object.keys(payload[eventType]) : null
        });
    }
  }

  setupErrorHandling() {
    // 404 handler
    this.express.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Global error handler
    this.express.use((error, req, res, next) => {
      this.logger.error('Unhandled error', { 
        error: error.message,
        stack: error.stack,
        path: req.path 
      });
      res.status(500).json({ error: 'Internal server error' });
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => {
      this.logger.info('SIGTERM received, shutting down gracefully...');
      this.server?.close(() => {
        this.logger.info('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      this.logger.info('SIGINT received, shutting down gracefully...');
      this.server?.close(() => {
        this.logger.info('Server closed');
        process.exit(0);
      });
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled promise rejection', { reason, promise });
    });

    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });
  }

  async start() {
    await this.initialize();
    
    const port = this.config.webhook.port || 5002;
    this.server = this.express.listen(port, () => {
      this.logger.info(`Server started on port ${port}`);
    });

    return this.server;
  }
}

module.exports = App;