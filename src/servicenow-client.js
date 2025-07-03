const axios = require('axios');

class ServiceNowClient {
  constructor({ instanceUrl, username, password }) {
    this.instanceUrl = instanceUrl.replace(/\/$/, ''); // Remove trailing slash
    this.auth = {
      username,
      password
    };
    
    this.client = axios.create({
      baseURL: `${this.instanceUrl}/api/now`,
      auth: this.auth,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  async createIncident(incidentData) {
    try {
      const response = await this.client.post('/table/incident', incidentData);
      return response.data.result;
    } catch (error) {
      console.error('Error creating ServiceNow incident:', error.response?.data || error.message);
      throw error;
    }
  }

  async updateIncident(sysId, incidentData) {
    try {
      const response = await this.client.put(`/table/incident/${sysId}`, incidentData);
      return response.data.result;
    } catch (error) {
      console.error('Error updating ServiceNow incident:', error.response?.data || error.message);
      throw error;
    }
  }

  async addWorkNotes(sysId, workNotes) {
    try {
      const response = await this.client.put(`/table/incident/${sysId}`, {
        work_notes: workNotes
      });
      return response.data.result;
    } catch (error) {
      console.error('Error adding work notes to ServiceNow incident:', error.response?.data || error.message);
      throw error;
    }
  }

  async getWorkNotes(sysId) {
    try {
      const response = await this.client.get(`/table/incident/${sysId}`, {
        params: {
          sysparm_fields: 'work_notes'
        }
      });
      return response.data.result.work_notes || '';
    } catch (error) {
      console.error('Error getting work notes from ServiceNow incident:', error.response?.data || error.message);
      throw error;
    }
  }

  async findIncidentByIncidentIoId(incidentIoId) {
    try {
      const response = await this.client.get('/table/incident', {
        params: {
          sysparm_query: `u_incident_io_id=${incidentIoId}`,
          sysparm_limit: 1
        }
      });
      
      return response.data.result.length > 0 ? response.data.result[0] : null;
    } catch (error) {
      console.error('Error finding ServiceNow incident:', error.response?.data || error.message);
      throw error;
    }
  }

  async getIncident(sysId) {
    try {
      const response = await this.client.get(`/table/incident/${sysId}`);
      return response.data.result;
    } catch (error) {
      console.error('Error getting ServiceNow incident:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = ServiceNowClient;