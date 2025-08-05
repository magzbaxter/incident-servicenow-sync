const axios = require('axios');

class IncidentIOClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.baseURL = config.api_url || 'https://api.incident.io/v2';

    // Setup axios instance
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: config.api_timeout || 30000,
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

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
          this.logger.warn(`Retrying incident.io request (attempt ${config.retry.count})`, {
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
   * Get a single incident by ID
   */
  async getIncident(incidentId) {
    try {
      this.logger.debug('Fetching incident from incident.io', { incident_id: incidentId });
      
      const response = await this.client.get(`/incidents/${incidentId}`);
      
      this.logger.debug('Successfully fetched incident', {
        incident_id: incidentId,
        status: response.data.incident.status,
        severity: response.data.incident.severity
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch incident from incident.io', {
        incident_id: incidentId,
        error: error.message,
        status: error.response?.status,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Get multiple incidents with filters
   */
  async getIncidents(options = {}) {
    try {
      const { 
        limit = 100, 
        status = null, 
        severity = null,
        created_after = null,
        created_before = null 
      } = options;

      this.logger.debug('Fetching incidents from incident.io', options);

      const params = { page_size: limit };
      
      if (status) params.status = status;
      if (severity) params.severity = severity;
      if (created_after) params.created_after = created_after;
      if (created_before) params.created_before = created_before;

      const response = await this.client.get('/incidents', { params });
      
      this.logger.debug('Successfully fetched incidents', {
        count: response.data.incidents?.length || 0,
        total: response.data.pagination?.total_count
      });

      return response.data.incidents || [];
    } catch (error) {
      this.logger.error('Failed to fetch incidents from incident.io', {
        error: error.message,
        status: error.response?.status,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Get incident updates/timeline
   */
  async getIncidentUpdates(incidentId) {
    try {
      this.logger.debug('Fetching incident updates from incident.io', { incident_id: incidentId });
      
      const response = await this.client.get(`/incidents/${incidentId}/updates`);
      
      this.logger.debug('Successfully fetched incident updates', {
        incident_id: incidentId,
        updates_count: response.data.updates?.length || 0
      });

      return response.data.updates || [];
    } catch (error) {
      this.logger.error('Failed to fetch incident updates from incident.io', {
        incident_id: incidentId,
        error: error.message,
        status: error.response?.status,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Get the most recent update for an incident
   */
  async getLatestIncidentUpdate(incidentId) {
    try {
      const updates = await this.getIncidentUpdates(incidentId);
      
      if (updates && updates.length > 0) {
        // Updates are typically returned in reverse chronological order
        const latestUpdate = updates[0];
        
        this.logger.debug('Found latest incident update', {
          incident_id: incidentId,
          update_id: latestUpdate.id,
          created_at: latestUpdate.created_at
        });

        return latestUpdate;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to get latest incident update', {
        incident_id: incidentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get incident types
   */
  async getIncidentTypes() {
    try {
      this.logger.debug('Fetching incident types from incident.io');
      
      const response = await this.client.get('/incident_types');
      
      this.logger.debug('Successfully fetched incident types', {
        count: response.data.incident_types?.length || 0
      });

      return response.data.incident_types || [];
    } catch (error) {
      this.logger.error('Failed to fetch incident types from incident.io', {
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Get severity levels
   */
  async getSeverities() {
    try {
      this.logger.debug('Fetching severities from incident.io');
      
      const response = await this.client.get('/severities');
      
      this.logger.debug('Successfully fetched severities', {
        count: response.data.severities?.length || 0
      });

      return response.data.severities || [];
    } catch (error) {
      this.logger.error('Failed to fetch severities from incident.io', {
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Get users
   */
  async getUsers(options = {}) {
    try {
      const { limit = 100, email = null } = options;
      
      this.logger.debug('Fetching users from incident.io', options);

      const params = { page_size: limit };
      if (email) params.email = email;

      const response = await this.client.get('/users', { params });
      
      this.logger.debug('Successfully fetched users', {
        count: response.data.users?.length || 0
      });

      return response.data.users || [];
    } catch (error) {
      this.logger.error('Failed to fetch users from incident.io', {
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email) {
    try {
      const users = await this.getUsers({ email });
      return users.find(user => user.email?.toLowerCase() === email.toLowerCase()) || null;
    } catch (error) {
      this.logger.error('Failed to get user by email', {
        email,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Search for incidents
   */
  async searchIncidents(query, options = {}) {
    try {
      const { limit = 50 } = options;
      
      this.logger.debug('Searching incidents in incident.io', { query, ...options });

      const response = await this.client.get('/incidents', {
        params: {
          page_size: limit,
          q: query
        }
      });

      this.logger.debug('Successfully searched incidents', {
        query,
        count: response.data.incidents?.length || 0
      });

      return response.data.incidents || [];
    } catch (error) {
      this.logger.error('Failed to search incidents in incident.io', {
        query,
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Get organization info
   */
  async getOrganization() {
    try {
      this.logger.debug('Fetching organization info from incident.io');
      
      const response = await this.client.get('/organisation');
      
      this.logger.debug('Successfully fetched organization info');

      return response.data.organisation;
    } catch (error) {
      this.logger.error('Failed to fetch organization info from incident.io', {
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Test connection to incident.io API
   */
  async testConnection() {
    try {
      await this.getOrganization();
      
      this.logger.info('incident.io connection test successful');
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      this.logger.error('incident.io connection test failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get API rate limit status
   */
  async getRateLimitStatus() {
    try {
      // Make a lightweight request to check rate limits
      const response = await this.client.get('/organisation');
      
      return {
        limit: response.headers['x-ratelimit-limit'],
        remaining: response.headers['x-ratelimit-remaining'],
        reset: response.headers['x-ratelimit-reset']
      };
    } catch (error) {
      this.logger.warn('Failed to get rate limit status', { error: error.message });
      return null;
    }
  }

  /**
   * Update an incident's basic information
   */
  async updateIncident(incidentId, updateData) {
    try {
      this.logger.info('Updating incident in incident.io', { 
        incident_id: incidentId,
        fields: Object.keys(updateData)
      });
      
      const response = await this.client.patch(`/incidents/${incidentId}`, updateData);
      
      this.logger.info('Successfully updated incident in incident.io', {
        incident_id: incidentId,
        updated_fields: Object.keys(updateData)
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to update incident in incident.io', {
        incident_id: incidentId,
        error: error.message,
        status: error.response?.status,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Update incident title (name)
   */
  async updateIncidentTitle(incidentId, title) {
    return this.updateIncident(incidentId, { name: title });
  }

  /**
   * Update incident summary
   */
  async updateIncidentSummary(incidentId, summary) {
    return this.updateIncident(incidentId, { summary });
  }

  /**
   * Add an update/note to an incident
   */
  async addIncidentUpdate(incidentId, message, options = {}) {
    try {
      const { 
        status = null,
        severity = null,
        update_type = 'update'
      } = options;

      this.logger.info('Adding update to incident in incident.io', { 
        incident_id: incidentId,
        update_type
      });

      const updateData = {
        message,
        update_type
      };

      if (status) updateData.new_incident_status = status;
      if (severity) updateData.new_severity = severity;
      
      const response = await this.client.post(`/incidents/${incidentId}/updates`, updateData);
      
      this.logger.info('Successfully added update to incident in incident.io', {
        incident_id: incidentId,
        update_id: response.data.update?.id
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to add update to incident in incident.io', {
        incident_id: incidentId,
        error: error.message,
        status: error.response?.status,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Get incident by ServiceNow number or identifier
   */
  async findIncidentByServiceNowId(serviceNowNumber) {
    try {
      this.logger.debug('Searching for incident by ServiceNow number', { 
        servicenow_number: serviceNowNumber 
      });

      // Search incidents by external reference or in summary/title
      const incidents = await this.searchIncidents(serviceNowNumber);
      
      // Look for exact match in external references or title
      const matchedIncident = incidents.find(incident => 
        incident.name?.includes(serviceNowNumber) ||
        incident.summary?.includes(serviceNowNumber) ||
        incident.external_issue_reference?.includes(serviceNowNumber)
      );

      if (matchedIncident) {
        this.logger.debug('Found incident by ServiceNow number', {
          servicenow_number: serviceNowNumber,
          incident_id: matchedIncident.id
        });
        return matchedIncident;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to find incident by ServiceNow number', {
        servicenow_number: serviceNowNumber,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Format incident data for consistency
   */
  formatIncidentData(incident) {
    return {
      incident: {
        ...incident,
        // Ensure consistent field names
        id: incident.id,
        name: incident.name || incident.title,
        summary: incident.summary,
        status: incident.status,
        severity: incident.severity,
        created_at: incident.created_at,
        updated_at: incident.updated_at,
        incident_lead: incident.incident_lead,
        creator: incident.creator,
        permalink: incident.permalink
      }
    };
  }

  /**
   * Update incident custom fields
   */
  async updateIncidentCustomFields(incidentId, customFieldEntries, notifyChannel = true) {
    try {
      this.logger.info('Updating incident custom fields', { 
        incident_id: incidentId,
        field_count: customFieldEntries.length
      });
      
      const response = await this.client.post(`/incidents/${incidentId}/actions/edit`, {
        incident: {
          custom_field_entries: customFieldEntries
        },
        notify_incident_channel: notifyChannel
      });
      
      this.logger.info('Successfully updated incident custom fields', {
        incident_id: incidentId
      });
      return response.data;
    } catch (error) {
      this.logger.error('Failed to update incident custom fields', {
        incident_id: incidentId,
        error: error.message,
        status: error.response?.status,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Add ServiceNow link to incident custom field
   */
  async addServiceNowLink(incidentId, serviceNowIncident, customFieldId = "01K0WGCNQDEP3RCKDF4PS7X3QS") {
    try {
      const serviceNowUrl = `https://dev304703.service-now.com/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${serviceNowIncident.sys_id}`;
      
      const customFieldEntries = [{
        custom_field_id: customFieldId,
        values: [{
          id: customFieldId,
          value_link: serviceNowUrl
        }]
      }];

      this.logger.info('Adding ServiceNow link to incident', { 
        incident_id: incidentId,
        servicenow_number: serviceNowIncident.number,
        servicenow_url: serviceNowUrl
      });

      return await this.updateIncidentCustomFields(incidentId, customFieldEntries, true);
    } catch (error) {
      this.logger.error('Failed to add ServiceNow link to incident', {
        incident_id: incidentId,
        servicenow_number: serviceNowIncident?.number || 'unknown',
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = IncidentIOClient;