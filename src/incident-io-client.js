const axios = require('axios');

class IncidentIOClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    
    this.client = axios.create({
      baseURL: 'https://api.incident.io/v2',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  async getIncident(incidentId) {
    try {
      const response = await this.client.get(`/incidents/${incidentId}`);
      return response.data.incident;
    } catch (error) {
      console.error('Error fetching incident from incident.io:', error.response?.data || error.message);
      throw error;
    }
  }

  async getIncidentUpdates(incidentId) {
    try {
      const response = await this.client.get(`/incidents/${incidentId}/updates`);
      return response.data.updates || [];
    } catch (error) {
      console.error('Error fetching incident updates from incident.io:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = IncidentIOClient;