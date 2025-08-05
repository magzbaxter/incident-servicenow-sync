const axios = require('axios');
const crypto = require('crypto');

class ServiceNowClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.baseURL = `${config.instance_url}/api/now`;
    this.cache = new Map(); // Simple in-memory cache for lookups
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes

    // Setup axios instance with authentication
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: config.api_timeout || 30000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    // Add authentication
    if (config.auth.type === 'basic') {
      this.client.defaults.auth = {
        username: config.auth.username,
        password: config.auth.password
      };
    }

    // Add retry interceptor
    this.setupRetryInterceptor();
  }

  setupRetryInterceptor() {
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const { config } = error;
        
        if (!config || !config.retry) {
          config.retry = { count: 0, delay: this.config.retry_delay || 1000 };
        }

        const shouldRetry = config.retry.count < (this.config.retry_attempts || 3) &&
          (error.response?.status >= 500 || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND');

        if (shouldRetry) {
          config.retry.count++;
          this.logger.warn(`Retrying ServiceNow request (attempt ${config.retry.count})`, {
            url: config.url,
            error: error.message
          });

          await new Promise(resolve => setTimeout(resolve, config.retry.delay));
          config.retry.delay *= 2; // Exponential backoff

          return this.client(config);
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Create a new incident in ServiceNow
   */
  async createIncident(data) {
    try {
      this.logger.info('Creating ServiceNow incident', { incident_io_id: data.u_incident_io_id });
      
      const response = await this.client.post(`/table/${this.config.table}`, data);
      
      this.logger.info('ServiceNow incident created', {
        incident_io_id: data.u_incident_io_id,
        servicenow_sys_id: response.data.result.sys_id,
        servicenow_number: response.data.result.number
      });

      return response.data.result;
    } catch (error) {
      this.logger.error('Failed to create ServiceNow incident', {
        incident_io_id: data.u_incident_io_id,
        error: error.message,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Update an existing incident in ServiceNow
   */
  async updateIncident(sysId, data) {
    try {
      this.logger.info('Updating ServiceNow incident', { 
        sys_id: sysId,
        update_data: data,
        urgency_value: data.urgency,
        impact_value: data.impact,
        priority_value: data.priority
      });
      
      const response = await this.client.patch(`/table/${this.config.table}/${sysId}`, data);
      
      this.logger.info('ServiceNow incident updated', {
        sys_id: sysId,
        servicenow_number: response.data.result.number,
        response_incident_state: response.data.result.incident_state,
        response_state: response.data.result.state,
        response_urgency: response.data.result.urgency,
        response_impact: response.data.result.impact,
        response_priority: response.data.result.priority
      });

      return response.data.result;
    } catch (error) {
      this.logger.error('Failed to update ServiceNow incident', {
        sys_id: sysId,
        error: error.message,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Find incident by incident.io ID
   */
  async findIncidentByIncidentIOId(incidentIOId) {
    try {
      const field = this.config.incident_id_field || 'u_incident_io_id';
      const queryString = `${field}=${incidentIOId}`;
      
      this.logger.debug('Searching for existing incident', {
        incident_io_id: incidentIOId,
        field: field,
        query: queryString,
        table: this.config.table
      });
      
      const response = await this.client.get(`/table/${this.config.table}`, {
        params: {
          sysparm_query: queryString,
          sysparm_limit: 1
        }
      });

      this.logger.debug('ServiceNow query response', {
        incident_io_id: incidentIOId,
        results_count: response.data.result ? response.data.result.length : 0,
        results: response.data.result
      });

      if (response.data.result && response.data.result.length > 0) {
        this.logger.debug('Found existing ServiceNow incident', {
          incident_io_id: incidentIOId,
          sys_id: response.data.result[0].sys_id
        });
        return response.data.result[0];
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to find ServiceNow incident', {
        incident_io_id: incidentIOId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Lookup user by name or email
   */
  async lookupUser(value, lookupField = 'name') {
    const cacheKey = `user:${lookupField}:${value}`;
    return this.cachedLookup(cacheKey, async () => {
      this.logger.debug('Looking up ServiceNow user', { value, lookup_field: lookupField });
      
      const response = await this.client.get('/table/sys_user', {
        params: {
          sysparm_query: `${lookupField}=${value}^active=true`,
          sysparm_fields: 'sys_id,name,email,user_name',
          sysparm_limit: 1
        }
      });

      if (response.data.result && response.data.result.length > 0) {
        const user = response.data.result[0];
        this.logger.debug('Found ServiceNow user', { 
          value, 
          sys_id: user.sys_id, 
          name: user.name 
        });
        return user.sys_id;
      }

      this.logger.warn('ServiceNow user not found', { value, lookup_field: lookupField });
      return null;
    });
  }

  /**
   * Lookup reference record by name in specified table
   */
  async lookupReference(table, value, lookupField = 'name') {
    const cacheKey = `reference:${table}:${lookupField}:${value}`;
    return this.cachedLookup(cacheKey, async () => {
      this.logger.debug('Looking up ServiceNow reference', { 
        table, 
        value, 
        lookup_field: lookupField 
      });
      
      const response = await this.client.get(`/table/${table}`, {
        params: {
          sysparm_query: `${lookupField}=${value}^active=true`,
          sysparm_fields: `sys_id,${lookupField}`,
          sysparm_limit: 1
        }
      });

      if (response.data.result && response.data.result.length > 0) {
        const record = response.data.result[0];
        this.logger.debug('Found ServiceNow reference', { 
          table,
          value, 
          sys_id: record.sys_id 
        });
        return record.sys_id;
      }

      this.logger.warn('ServiceNow reference not found', { 
        table, 
        value, 
        lookup_field: lookupField 
      });
      return null;
    });
  }

  /**
   * Get choice options for a field (useful for mapping validation)
   */
  async getChoiceOptions(table, field) {
    const cacheKey = `choices:${table}:${field}`;
    return this.cachedLookup(cacheKey, async () => {
      this.logger.debug('Getting ServiceNow choice options', { table, field });
      
      const response = await this.client.get('/table/sys_choice', {
        params: {
          sysparm_query: `name=${table}^element=${field}^inactive=false`,
          sysparm_fields: 'value,label',
          sysparm_orderby: 'sequence'
        }
      });

      const choices = response.data.result.reduce((acc, choice) => {
        acc[choice.value] = choice.label;
        return acc;
      }, {});

      this.logger.debug('Retrieved ServiceNow choice options', { 
        table, 
        field, 
        count: Object.keys(choices).length 
      });
      
      return choices;
    });
  }

  /**
   * Check if work note already exists (for deduplication)
   */
  async checkWorkNoteExists(sysId, workNote) {
    try {
      // Create a hash of the work note for comparison
      const noteHash = crypto.createHash('md5').update(workNote.trim()).digest('hex');
      
      const response = await this.client.get(`/table/${this.config.table}/${sysId}`, {
        params: {
          sysparm_fields: 'work_notes'
        }
      });

      if (response.data.result && response.data.result.work_notes) {
        const existingNotes = response.data.result.work_notes;
        const existingHash = crypto.createHash('md5').update(existingNotes.trim()).digest('hex');
        
        // Check if the new note content is already present
        const isDuplicate = existingNotes.includes(workNote.trim()) || 
                           existingHash === noteHash;
        
        if (isDuplicate) {
          this.logger.debug('Duplicate work note detected, skipping', { sys_id: sysId });
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.warn('Failed to check for duplicate work note', {
        sys_id: sysId,
        error: error.message
      });
      // If we can't check, allow the update to proceed
      return false;
    }
  }

  /**
   * Get table schema information
   */
  async getTableSchema(tableName) {
    const cacheKey = `schema:${tableName}`;
    return this.cachedLookup(cacheKey, async () => {
      const response = await this.client.get(`/table/sys_dictionary`, {
        params: {
          sysparm_query: `name=${tableName}^active=true`,
          sysparm_fields: 'element,column_label,max_length,mandatory,reference,internal_type'
        }
      });

      const schema = response.data.result.reduce((acc, field) => {
        acc[field.element] = {
          label: field.column_label,
          maxLength: field.max_length,
          mandatory: field.mandatory === 'true',
          reference: field.reference,
          type: field.internal_type
        };
        return acc;
      }, {});

      this.logger.debug('Retrieved table schema', { 
        table: tableName, 
        fields: Object.keys(schema).length 
      });

      return schema;
    });
  }

  /**
   * Cached lookup helper to reduce API calls
   */
  async cachedLookup(cacheKey, lookupFunction) {
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        this.logger.debug('Using cached lookup result', { cache_key: cacheKey });
        return cached.value;
      } else {
        this.cache.delete(cacheKey);
      }
    }

    // Perform lookup
    try {
      const value = await lookupFunction();
      
      // Cache the result
      this.cache.set(cacheKey, {
        value,
        timestamp: Date.now()
      });

      return value;
    } catch (error) {
      this.logger.error('Lookup failed', { cache_key: cacheKey, error: error.message });
      throw error;
    }
  }

  /**
   * Clear lookup cache (useful for testing or manual refresh)
   */
  clearCache() {
    this.cache.clear();
    this.logger.info('ServiceNow lookup cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Get incident by ServiceNow sys_id
   */
  async getIncidentBySysId(sysId) {
    try {
      this.logger.debug('Getting ServiceNow incident by sys_id', { sys_id: sysId });
      
      const response = await this.client.get(`/table/${this.config.table}/${sysId}`);
      
      if (response.data.result) {
        this.logger.debug('Found ServiceNow incident', {
          sys_id: sysId,
          number: response.data.result.number
        });
        return response.data.result;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to get ServiceNow incident by sys_id', {
        sys_id: sysId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get incident.io ID from ServiceNow incident
   */
  async getIncidentIOIdFromServiceNow(sysId) {
    try {
      const incident = await this.getIncidentBySysId(sysId);
      if (!incident) return null;

      const field = this.config.incident_id_field || 'u_incident_io_id';
      const incidentIOId = incident[field];

      this.logger.debug('Retrieved incident.io ID from ServiceNow', {
        sys_id: sysId,
        incident_io_id: incidentIOId
      });

      return incidentIOId;
    } catch (error) {
      this.logger.error('Failed to get incident.io ID from ServiceNow', {
        sys_id: sysId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Test ServiceNow connection
   */
  async testConnection() {
    try {
      const response = await this.client.get('/table/sys_user', {
        params: { sysparm_limit: 1 }
      });
      
      this.logger.info('ServiceNow connection test successful');
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      this.logger.error('ServiceNow connection test failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }
}

module.exports = ServiceNowClient;