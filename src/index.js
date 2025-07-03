require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const ServiceNowClient = require('./servicenow-client');
const IncidentIOClient = require('./incident-io-client');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const servicenow = new ServiceNowClient({
  instanceUrl: process.env.SERVICENOW_INSTANCE_URL,
  username: process.env.SERVICENOW_USERNAME,
  password: process.env.SERVICENOW_PASSWORD
});

const incidentio = new IncidentIOClient(process.env.INCIDENT_IO_API_KEY);

// Webhook signature verification middleware
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-incident-signature'];
  const secret = process.env.INCIDENT_IO_WEBHOOK_SECRET;
  
  if (!signature || !secret) {
    console.log('Missing signature or secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  if (signature !== `sha256=${expectedSignature}`) {
    console.log('Signature mismatch');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main webhook endpoint
app.post('/webhook/incident', verifyWebhookSignature, async (req, res) => {
  try {
    console.log('Received webhook:', JSON.stringify(req.body, null, 2));
    
    const { event_type, incident } = req.body;
    
    if (!incident) {
      return res.status(400).json({ error: 'No incident data found' });
    }

    switch (event_type) {
      case 'incident.created':
        await handleIncidentCreated(incident);
        break;
      case 'incident.updated':
        await handleIncidentUpdated(incident);
        break;
      default:
        console.log(`Unhandled event type: ${event_type}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function handleIncidentCreated(incident) {
  console.log(`Creating ServiceNow incident for: ${incident.name || incident.id}`);
  
  // Call incident.io API to get full incident details (like Chris does)
  let fullIncident;
  try {
    fullIncident = await incidentio.getIncident(incident.id);
  } catch (error) {
    console.log('Failed to fetch full incident details, using webhook data');
    fullIncident = incident;
  }
  
  const servicenowIncident = await servicenow.createIncident({
    short_description: fullIncident.name || fullIncident.id,
    description: fullIncident.summary || 'Created from incident.io',
    urgency: mapSeverityToUrgency(fullIncident.severity?.name),
    impact: mapSeverityToImpact(fullIncident.severity?.name),
    state: mapStatusToState(fullIncident.status?.name),
    u_incident_io_id: fullIncident.id
  });

  console.log('ServiceNow incident created:', servicenowIncident.number);
}

async function handleIncidentUpdated(incident) {
  console.log(`Updating ServiceNow incident for: ${incident.name || incident.id}`);
  
  // Call incident.io API to get full incident details (like Chris does)
  let fullIncident;
  try {
    fullIncident = await incidentio.getIncident(incident.id);
  } catch (error) {
    console.log('Failed to fetch full incident details, using webhook data');
    fullIncident = incident;
  }
  
  // Find the ServiceNow incident by incident.io ID
  const servicenowIncident = await servicenow.findIncidentByIncidentIoId(fullIncident.id);
  
  if (!servicenowIncident) {
    console.log('ServiceNow incident not found, creating new one');
    await handleIncidentCreated(fullIncident);
    return;
  }

  // Update work notes with incident updates (Chris's key feature)
  await updateWorkNotesWithLatestUpdates(fullIncident.id, servicenowIncident.sys_id);

  // Update main incident fields  
  await servicenow.updateIncident(servicenowIncident.sys_id, {
    short_description: fullIncident.name || fullIncident.id,
    description: fullIncident.summary || 'Updated from incident.io',
    urgency: mapSeverityToUrgency(fullIncident.severity?.name),
    impact: mapSeverityToImpact(fullIncident.severity?.name),
    state: mapStatusToState(fullIncident.status?.name)
  });

  console.log('ServiceNow incident updated:', servicenowIncident.number);
}

async function updateWorkNotesWithLatestUpdates(incidentId, servicenowSysId) {
  try {
    // Get incident updates from incident.io
    const updates = await incidentio.getIncidentUpdates(incidentId);
    
    if (!updates || updates.length === 0) {
      return;
    }

    // Get existing work notes to check for duplicates (Chris's deduplication)
    const existingWorkNotes = await servicenow.getWorkNotes(servicenowSysId);
    
    // Add new updates that aren't already in work notes
    for (const update of updates) {
      const updateText = update.message || update.body || 'Update from incident.io';
      
      // Simple deduplication - check if this update text already exists
      if (existingWorkNotes.includes(updateText)) {
        continue;
      }
      
      const workNoteEntry = `[${new Date(update.created_at || Date.now()).toISOString()}] ${updateText}`;
      await servicenow.addWorkNotes(servicenowSysId, workNoteEntry);
      console.log('Added work note:', updateText.substring(0, 50) + '...');
    }
  } catch (error) {
    console.error('Error updating work notes:', error.message);
  }
}

// Mapping functions
function mapSeverityToUrgency(severity) {
  const mapping = {
    'Critical': '1',
    'High': '2', 
    'Medium': '3',
    'Low': '3'
  };
  return mapping[severity] || '3';
}

function mapSeverityToImpact(severity) {
  const mapping = {
    'Critical': '1',
    'High': '2',
    'Medium': '3', 
    'Low': '3'
  };
  return mapping[severity] || '3';
}

function mapStatusToState(status) {
  const mapping = {
    'Open': '1',
    'Investigating': '2',
    'Identified': '2',
    'Monitoring': '6',
    'Resolved': '6',
    'Closed': '7'
  };
  return mapping[status] || '1';
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Webhook URL: ${process.env.RAILWAY_STATIC_URL || `http://localhost:${port}`}/webhook/incident`);
});