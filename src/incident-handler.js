class IncidentHandler {
  constructor(serviceNowClient, incidentIOClient, fieldMapper, config, logger) {
    this.serviceNowClient = serviceNowClient;
    this.incidentIOClient = incidentIOClient;
    this.fieldMapper = fieldMapper;
    this.config = config;
    this.logger = logger;
    // In-memory lock to prevent duplicate processing
    this.processingIncidents = new Set();
    // Track recent reverse sync updates to prevent loops (incident_id -> timestamp)
    this.recentReverseSyncUpdates = new Map();
  }

  /**
   * Track that a reverse sync update just happened for an incident
   */
  trackReverseSyncUpdate(incidentId) {
    this.recentReverseSyncUpdates.set(incidentId, Date.now());
    this.logger.debug('Tracked reverse sync update', { incident_id: incidentId });
    
    // Clean up old entries (older than 5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    for (const [id, timestamp] of this.recentReverseSyncUpdates.entries()) {
      if (timestamp < fiveMinutesAgo) {
        this.recentReverseSyncUpdates.delete(id);
      }
    }
  }

  /**
   * Check if we should skip forward sync due to recent reverse sync
   */
  shouldSkipForwardSync(incidentId) {
    const recentUpdate = this.recentReverseSyncUpdates.get(incidentId);
    if (recentUpdate) {
      const timeSinceUpdate = Date.now() - recentUpdate;
      const cooldownPeriod = 30 * 1000; // 30 seconds cooldown
      
      if (timeSinceUpdate < cooldownPeriod) {
        this.logger.info('Skipping forward sync due to recent reverse sync', {
          incident_id: incidentId,
          time_since_reverse_sync: timeSinceUpdate,
          cooldown_period: cooldownPeriod
        });
        return true;
      } else {
        // Remove expired entry
        this.recentReverseSyncUpdates.delete(incidentId);
      }
    }
    return false;
  }

  /**
   * Handle incident creation from incident.io
   */
  async createIncident(incidentId, webhookPayload = null) {
    this.logger.info('Processing incident creation', { incident_id: incidentId });

    // Check if this incident is already being processed
    if (this.processingIncidents.has(incidentId)) {
      this.logger.warn('Incident creation already in progress, skipping duplicate', { 
        incident_id: incidentId 
      });
      return;
    }

    // Add to processing set
    this.processingIncidents.add(incidentId);

    try {
      // Check if incident already exists in ServiceNow
      let existingIncident = await this.serviceNowClient.findIncidentByIncidentIOId(incidentId);
      if (existingIncident) {
        this.logger.warn('Incident already exists in ServiceNow, updating instead', {
          incident_id: incidentId,
          servicenow_sys_id: existingIncident.sys_id
        });
        return await this.updateIncident(incidentId, webhookPayload);
      }

      // Always fetch fresh incident details from incident.io to ensure current data
      // Note: Webhook payloads may contain stale data, so we always fetch current data
      this.logger.info('About to fetch fresh incident data from API for creation', { incident_id: incidentId });
      const incidentData = await this.incidentIOClient.getIncident(incidentId);
      
      // Map incident.io data to ServiceNow fields
      const mappedData = await this.fieldMapper.mapForCreation(incidentData, this.serviceNowClient);
      
      // Validate required fields
      this.validateRequiredFields(mappedData, 'creation');
      
      // Create incident in ServiceNow
      const serviceNowIncident = await this.serviceNowClient.createIncident(mappedData);
      
      this.logger.info('Incident created successfully', {
        incident_id: incidentId,
        servicenow_sys_id: serviceNowIncident.sys_id,
        servicenow_number: serviceNowIncident.number
      });

      // Add ServiceNow link to incident.io custom field if enabled
      if (this.config.features.add_servicenow_link) {
        try {
          await this.incidentIOClient.addServiceNowLink(incidentId, serviceNowIncident);
          this.logger.info('ServiceNow link added to incident.io', {
            incident_id: incidentId,
            servicenow_number: serviceNowIncident.number
          });
        } catch (error) {
          this.logger.warn('Failed to add ServiceNow link to incident.io (non-critical)', {
            incident_id: incidentId,
            servicenow_number: serviceNowIncident.number,
            error: error.message
          });
          // Don't fail the entire operation if adding the link fails
        }
      } else {
        this.logger.debug('ServiceNow link feature disabled, skipping', {
          incident_id: incidentId
        });
      }

      // Send success notification if configured
      await this.sendNotification('incident_created', {
        incident_id: incidentId,
        servicenow_incident: serviceNowIncident,
        incident_io_data: incidentData
      });

      return serviceNowIncident;

    } catch (error) {
      this.logger.error('Failed to create incident', {
        incident_id: incidentId,
        error: error.message,
        stack: error.stack
      });

      // Send error notification if configured
      await this.sendNotification('incident_creation_failed', {
        incident_id: incidentId,
        error: error.message
      });

      throw error;
    } finally {
      // Remove from processing set
      this.processingIncidents.delete(incidentId);
    }
  }

  /**
   * Handle incident update from incident.io
   */
  async updateIncident(incidentId, webhookPayload = null) {
    this.logger.info('Processing incident update', { incident_id: incidentId });

    // Check if we should skip this update due to recent reverse sync
    if (this.shouldSkipForwardSync(incidentId)) {
      return null; // Skip this update to prevent sync loop
    }

    try {
      // Find existing ServiceNow incident
      const existingIncident = await this.serviceNowClient.findIncidentByIncidentIOId(incidentId);
      if (!existingIncident) {
        this.logger.warn('ServiceNow incident not found, creating new one', {
          incident_id: incidentId
        });
        return await this.createIncident(incidentId, webhookPayload);
      }

      // Always fetch fresh incident details from incident.io to ensure current data
      // Note: Webhook payloads may contain stale data, so we always fetch current data
      this.logger.info('About to fetch fresh incident data from API', { incident_id: incidentId });
      const incidentData = await this.incidentIOClient.getIncident(incidentId);
      this.logger.info('Fetched fresh incident data', { 
        incident_id: incidentId,
        severity_name: incidentData.incident?.severity?.name,
        status_name: incidentData.incident?.incident_status?.name
      });
      
      // Map incident.io data to ServiceNow fields for update
      const mappedData = await this.fieldMapper.mapForUpdate(
        incidentData, 
        this.serviceNowClient, 
        existingIncident
      );

      // Handle work notes deduplication
      if (mappedData.work_notes && this.config.features.deduplicate_work_notes) {
        const isDuplicate = await this.serviceNowClient.checkWorkNoteExists(
          existingIncident.sys_id, 
          mappedData.work_notes
        );
        
        if (isDuplicate) {
          this.logger.info('Duplicate work note detected, skipping update', {
            incident_id: incidentId,
            servicenow_sys_id: existingIncident.sys_id
          });
          delete mappedData.work_notes;
        }
      }

      // Skip update if no changes
      if (Object.keys(mappedData).length === 0) {
        this.logger.info('No changes to update', { incident_id: incidentId });
        return existingIncident;
      }

      // Update incident in ServiceNow
      const updatedIncident = await this.serviceNowClient.updateIncident(
        existingIncident.sys_id, 
        mappedData
      );

      this.logger.info('Incident updated successfully', {
        incident_id: incidentId,
        servicenow_sys_id: existingIncident.sys_id,
        servicenow_number: updatedIncident.number,
        updated_fields: Object.keys(mappedData)
      });

      // Send success notification if configured
      await this.sendNotification('incident_updated', {
        incident_id: incidentId,
        servicenow_incident: updatedIncident,
        incident_io_data: incidentData,
        updated_fields: Object.keys(mappedData)
      });

      return updatedIncident;

    } catch (error) {
      this.logger.error('Failed to update incident', {
        incident_id: incidentId,
        error: error.message,
        stack: error.stack
      });

      // Send error notification if configured
      await this.sendNotification('incident_update_failed', {
        incident_id: incidentId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Sync all incidents from incident.io (bulk operation)
   */
  async syncAllIncidents(options = {}) {
    const { limit = 100, status = 'open', dryRun = false } = options;
    
    this.logger.info('Starting bulk incident sync', { limit, status, dryRun });

    try {
      // Get incidents from incident.io
      const incidents = await this.incidentIOClient.getIncidents({ limit, status });
      
      const results = {
        total: incidents.length,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: []
      };

      // Process incidents in batches
      const batchSize = this.config.performance?.batch_size || 10;
      const concurrency = this.config.performance?.concurrent_requests || 5;

      for (let i = 0; i < incidents.length; i += batchSize) {
        const batch = incidents.slice(i, i + batchSize);
        
        // Process batch with controlled concurrency
        const batchPromises = batch.map(incident => 
          this.processBatchIncident(incident, dryRun)
            .then(result => {
              results[result.action]++;
              return result;
            })
            .catch(error => {
              results.errors.push({
                incident_id: incident.id,
                error: error.message
              });
              return { action: 'error', incident_id: incident.id };
            })
        );

        // Limit concurrency
        const chunks = [];
        for (let j = 0; j < batchPromises.length; j += concurrency) {
          chunks.push(batchPromises.slice(j, j + concurrency));
        }

        for (const chunk of chunks) {
          await Promise.all(chunk);
          
          // Add delay between chunks to respect rate limits
          if (this.config.performance?.rate_limit?.requests_per_minute) {
            const delay = (60 / this.config.performance.rate_limit.requests_per_minute) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }

        this.logger.info(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(incidents.length / batchSize)}`, {
          processed: Math.min(i + batchSize, incidents.length),
          total: incidents.length
        });
      }

      this.logger.info('Bulk sync completed', results);
      return results;

    } catch (error) {
      this.logger.error('Bulk sync failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Process single incident during batch sync
   */
  async processBatchIncident(incident, dryRun) {
    try {
      const incidentId = incident.id;
      
      if (dryRun) {
        this.logger.info('Dry run - would sync incident', { incident_id: incidentId });
        return { action: 'skipped', incident_id: incidentId };
      }

      // Check if incident exists in ServiceNow
      const existingIncident = await this.serviceNowClient.findIncidentByIncidentIOId(incidentId);
      
      if (existingIncident) {
        await this.updateIncident(incidentId, { incident });
        return { action: 'updated', incident_id: incidentId };
      } else {
        await this.createIncident(incidentId, { incident });
        return { action: 'created', incident_id: incidentId };
      }

    } catch (error) {
      this.logger.error('Failed to process batch incident', {
        incident_id: incident.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate required fields for ServiceNow
   */
  validateRequiredFields(data, operation) {
    const validationRules = this.fieldMapper.mappingsConfig.validation_rules;
    if (!validationRules) return;

    const requiredFields = operation === 'creation' 
      ? validationRules.required_fields_creation 
      : validationRules.required_fields_update;

    if (!requiredFields) return;

    const missingFields = requiredFields.filter(field => 
      data[field] === null || data[field] === undefined || data[field] === ''
    );

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields for ${operation}: ${missingFields.join(', ')}`);
    }
  }

  /**
   * Send notification (placeholder for future notification system)
   */
  async sendNotification(eventType, data) {
    // This could be extended to send notifications to Slack, email, etc.
    this.logger.debug('Notification event', { event_type: eventType, data });
    
    // Example: Send to webhook endpoint
    if (this.config.notifications?.webhook_url) {
      try {
        // Implementation would go here
        this.logger.info('Notification sent', { event_type: eventType });
      } catch (error) {
        this.logger.warn('Failed to send notification', { 
          event_type: eventType, 
          error: error.message 
        });
      }
    }
  }

  /**
   * Get sync statistics
   */
  async getSyncStats() {
    try {
      // This could be expanded to track more detailed statistics
      return {
        cache_stats: this.serviceNowClient.getCacheStats(),
        field_mapping_config: this.fieldMapper.getMappingConfig(),
        last_sync: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Failed to get sync stats', { error: error.message });
      return { error: error.message };
    }
  }

  /**
   * Health check for incident handler
   */
  async healthCheck() {
    const health = {
      status: 'healthy',
      checks: {}
    };

    try {
      // Test ServiceNow connection
      const serviceNowTest = await this.serviceNowClient.testConnection();
      health.checks.servicenow = serviceNowTest;

      // Test incident.io connection
      const incidentIoTest = await this.incidentIOClient.testConnection();
      health.checks.incident_io = incidentIoTest;

      // Test field mapper configuration
      const mappingValidation = this.fieldMapper.validateConfiguration();
      health.checks.field_mappings = mappingValidation;

      // Overall status
      const hasErrors = Object.values(health.checks).some(check => !check.valid && !check.success);
      if (hasErrors) {
        health.status = 'unhealthy';
      }

    } catch (error) {
      health.status = 'error';
      health.error = error.message;
    }

    return health;
  }

  /**
   * Clear all caches
   */
  clearCaches() {
    this.serviceNowClient.clearCache();
    this.logger.info('All caches cleared');
  }
}

module.exports = IncidentHandler;