const fs = require('fs').promises;
const path = require('path');

class ConfigManager {
  constructor(configDir = 'config') {
    this.configDir = configDir;
    this.config = null;
    this.fieldMappings = null;
  }

  /**
   * Load all configuration files
   */
  async load() {
    try {
      // Load main configuration
      await this.loadMainConfig();
      
      // Load field mappings
      await this.loadFieldMappings();
      
      // Validate configuration
      this.validateConfig();
      
      console.log('Configuration loaded successfully');
      return this.getFullConfig();
    } catch (error) {
      console.error('Failed to load configuration:', error.message);
      throw error;
    }
  }

  /**
   * Load main configuration file
   */
  async loadMainConfig() {
    const configPaths = [
      path.join(this.configDir, 'config.json'),
      path.join(this.configDir, 'config.example.json')
    ];

    for (const configPath of configPaths) {
      try {
        const configContent = await fs.readFile(configPath, 'utf8');
        this.config = JSON.parse(configContent);
        
        // Substitute environment variables
        this.substituteEnvironmentVariables(this.config);
        
        console.log(`Loaded configuration from ${configPath}`);
        return;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw new Error(`Failed to parse ${configPath}: ${error.message}`);
        }
      }
    }

    throw new Error('No configuration file found. Please copy config.example.json to config.json');
  }

  /**
   * Load field mappings configuration
   */
  async loadFieldMappings() {
    const mappingPaths = [
      path.join(this.configDir, 'field-mappings.json'),
      path.join(this.configDir, 'field-mappings.example.json')
    ];

    for (const mappingPath of mappingPaths) {
      try {
        const mappingContent = await fs.readFile(mappingPath, 'utf8');
        this.fieldMappings = JSON.parse(mappingContent);
        
        console.log(`Loaded field mappings from ${mappingPath}`);
        return;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw new Error(`Failed to parse ${mappingPath}: ${error.message}`);
        }
      }
    }

    throw new Error('No field mappings file found. Please copy field-mappings.example.json to field-mappings.json');
  }

  /**
   * Substitute environment variables in configuration
   */
  substituteEnvironmentVariables(obj) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        const envVar = value.slice(2, -1);
        const envValue = process.env[envVar];
        
        if (envValue === undefined && this.isRequiredEnvVar(envVar)) {
          throw new Error(`Required environment variable ${envVar} is not set`);
        }
        
        obj[key] = envValue || value;
      } else if (typeof value === 'object' && value !== null) {
        this.substituteEnvironmentVariables(value);
      }
    }
  }

  /**
   * Check if environment variable is required
   */
  isRequiredEnvVar(varName) {
    const requiredVars = [
      'INCIDENT_IO_API_KEY',
      'SERVICENOW_USERNAME', 
      'SERVICENOW_PASSWORD',
      'WEBHOOK_SECRET'
    ];
    return requiredVars.includes(varName);
  }

  /**
   * Validate configuration
   */
  validateConfig() {
    const errors = [];

    // Validate ServiceNow configuration
    if (!this.config.servicenow) {
      errors.push('ServiceNow configuration is missing');
    } else {
      if (!this.config.servicenow.instance_url) {
        errors.push('ServiceNow instance_url is required');
      }
      if (!this.config.servicenow.auth?.username) {
        errors.push('ServiceNow username is required');
      }
      if (!this.config.servicenow.auth?.password) {
        errors.push('ServiceNow password is required');
      }
    }

    // Validate incident.io configuration
    if (!this.config.incident_io) {
      errors.push('Incident.io configuration is missing');
    } else {
      if (!this.config.incident_io.api_key) {
        errors.push('Incident.io API key is required');
      }
    }

    // Validate webhook configuration
    if (!this.config.webhook) {
      errors.push('Webhook configuration is missing');
    } else {
      if (this.config.webhook.verify_signature && !this.config.webhook.secret) {
        errors.push('Webhook secret is required when signature verification is enabled');
      }
    }

    // Validate field mappings
    if (!this.fieldMappings) {
      errors.push('Field mappings configuration is missing');
    } else {
      const mappingErrors = this.validateFieldMappings();
      errors.push(...mappingErrors);
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Validate field mappings configuration
   */
  validateFieldMappings() {
    const errors = [];

    // Validate incident creation mappings
    if (this.fieldMappings.incident_creation) {
      for (const [field, mapping] of Object.entries(this.fieldMappings.incident_creation)) {
        const fieldErrors = this.validateFieldMapping(field, mapping, 'creation');
        errors.push(...fieldErrors);
      }
    }

    // Validate incident update mappings
    if (this.fieldMappings.incident_updates) {
      for (const [field, mapping] of Object.entries(this.fieldMappings.incident_updates)) {
        const fieldErrors = this.validateFieldMapping(field, mapping, 'update');
        errors.push(...fieldErrors);
      }
    }

    // Validate custom mappings
    if (this.fieldMappings.custom_mappings) {
      for (const [field, mapping] of Object.entries(this.fieldMappings.custom_mappings)) {
        if (!mapping.expression) {
          errors.push(`Custom mapping ${field}: expression is required`);
        }
      }
    }

    return errors;
  }

  /**
   * Validate individual field mapping
   */
  validateFieldMapping(fieldName, mapping, context) {
    const errors = [];

    // Check required properties
    if (!mapping.type) {
      errors.push(`${context} mapping ${fieldName}: type is required`);
      return errors;
    }

    // Validate based on type
    switch (mapping.type) {
      case 'text':
        if (!mapping.source) {
          errors.push(`${context} mapping ${fieldName}: source is required for text type`);
        }
        break;

      case 'user_lookup':
        if (!mapping.source) {
          errors.push(`${context} mapping ${fieldName}: source is required for user_lookup type`);
        }
        break;

      case 'reference_lookup':
        if (!mapping.source) {
          errors.push(`${context} mapping ${fieldName}: source is required for reference_lookup type`);
        }
        if (!mapping.lookup_table) {
          errors.push(`${context} mapping ${fieldName}: lookup_table is required for reference_lookup type`);
        }
        break;

      case 'choice_mapping':
        if (!mapping.source) {
          errors.push(`${context} mapping ${fieldName}: source is required for choice_mapping type`);
        }
        if (!mapping.mappings || typeof mapping.mappings !== 'object') {
          errors.push(`${context} mapping ${fieldName}: mappings object is required for choice_mapping type`);
        }
        break;

      case 'expression':
        if (!mapping.expression) {
          errors.push(`${context} mapping ${fieldName}: expression is required for expression type`);
        }
        break;

      default:
        errors.push(`${context} mapping ${fieldName}: unknown type '${mapping.type}'`);
    }

    return errors;
  }

  /**
   * Get full configuration object
   */
  getFullConfig() {
    return {
      ...this.config,
      field_mappings: this.fieldMappings
    };
  }

  /**
   * Get ServiceNow configuration
   */
  get servicenow() {
    return this.config?.servicenow;
  }

  /**
   * Get incident.io configuration
   */
  get incident_io() {
    return this.config?.incident_io;
  }

  /**
   * Get webhook configuration
   */
  get webhook() {
    return this.config?.webhook;
  }

  /**
   * Get logging configuration
   */
  get logging() {
    return this.config?.logging || { level: 'info' };
  }

  /**
   * Get features configuration
   */
  get features() {
    return this.config?.features || {
      create_incidents: true,
      update_incidents: true,
      deduplicate_work_notes: true,
      sync_attachments: false
    };
  }

  /**
   * Get performance configuration
   */
  get performance() {
    return this.config?.performance || {
      concurrent_requests: 5,
      batch_size: 10,
      rate_limit: { requests_per_minute: 60 }
    };
  }

  /**
   * Get field mappings configuration
   */
  get field_mappings() {
    return this.fieldMappings;
  }

  /**
   * Save current configuration to file (for debugging)
   */
  async saveConfig(filename = 'config.debug.json') {
    try {
      const configPath = path.join(this.configDir, filename);
      await fs.writeFile(configPath, JSON.stringify(this.getFullConfig(), null, 2));
      console.log(`Configuration saved to ${configPath}`);
    } catch (error) {
      console.error('Failed to save configuration:', error.message);
      throw error;
    }
  }

  /**
   * Reload configuration (useful for development)
   */
  async reload() {
    this.config = null;
    this.field_mappings = null;
    await this.load();
    console.log('Configuration reloaded');
  }

  /**
   * Get configuration summary for health check
   */
  getConfigSummary() {
    return {
      servicenow_instance: this.config?.servicenow?.instance_url,
      incident_io_api: this.config?.incident_io?.api_url,
      webhook_port: this.config?.webhook?.port,
      features: this.features,
      field_mappings: {
        creation_fields: Object.keys(this.fieldMappings?.incident_creation || {}),
        update_fields: Object.keys(this.fieldMappings?.incident_updates || {}),
        custom_fields: Object.keys(this.fieldMappings?.custom_mappings || {})
      }
    };
  }

  /**
   * Check if configuration is valid
   */
  isValid() {
    try {
      this.validateConfig();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get environment variables template
   */
  static getEnvTemplate() {
    return `# incident.io API Configuration
INCIDENT_IO_API_KEY=your_incident_io_private_api_key

# ServiceNow Configuration
SERVICENOW_USERNAME=your_servicenow_username
SERVICENOW_PASSWORD=your_servicenow_password

# Webhook Configuration
WEBHOOK_SECRET=your_webhook_secret_for_signature_verification

# Optional: Override default values
# WEBHOOK_PORT=5002
# LOG_LEVEL=info`;
  }
}

module.exports = ConfigManager;