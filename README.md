# Incident.io ↔ ServiceNow Bidirectional Sync

A production-ready integration that provides real-time bidirectional synchronization between incident.io and ServiceNow incident management systems.

## Sync Scope

This integration synchronizes the following core incident data between systems:

### Forward Sync (incident.io → ServiceNow)
| incident.io Field | ServiceNow Field | Description |
|---|---|---|
| **Name** | Short Description | Incident title |
| **Summary** | Description | Detailed incident description |
| **Severity** | Impact & Urgency | Maps severity levels to ServiceNow priority fields |
| **Status** | State | Incident status/workflow state |
| **ID & URL** | Custom Fields | Links for cross-system navigation |

### Reverse Sync (ServiceNow → incident.io)
| ServiceNow Field | incident.io Field | Description |
|---|---|---|
| **Short Description** | Name | Incident title updates |
| **Description** | Summary | Description changes |
| **Priority/Impact/Urgency** | Severity | Priority changes mapped to severity |
| **State** | Status* | Workflow state changes |

**\* Status Sync Limitation:** incident.io enforces workflow rules that only allow transitions between "live" statuses (Investigating, Fixing, Monitoring). **You cannot close incidents from ServiceNow** - attempting to set ServiceNow incidents to Resolved/Closed will not close the incident.io incident. Close incidents directly in incident.io to maintain proper workflow compliance.

**Key Features:**
- **Essential field mapping** - Core incident data only, avoiding complex CMDB integrations
- **Bidirectional sync** - Changes in either system update the other automatically  
- **Loop prevention** - Intelligent cooldowns prevent infinite sync loops
- **Production ready** - Docker deployment, health checks, comprehensive logging

## Features

### Forward Sync (incident.io → ServiceNow)
- **Incident Creation**: Automatically creates ServiceNow incidents when new incidents are created in incident.io
- **Incident Updates**: Synchronizes incident.io changes (status, severity, assignments, descriptions) to ServiceNow
- **Field Mapping**: Flexible mapping between incident.io and ServiceNow fields via configuration
- **User Lookups**: Maps incident.io users to ServiceNow user records

### Reverse Sync (ServiceNow → incident.io)  
- **Status Sync**: Updates incident.io incident status when ServiceNow incident state changes
- **Severity Sync**: Maps ServiceNow priority/urgency/impact to incident.io severity levels
- **Field Updates**: Syncs ServiceNow changes (title, description, work notes) back to incident.io
- **Loop Prevention**: Intelligent cooldown mechanisms prevent infinite sync loops

### Production Features
- **Webhook Security**: Signature verification for both incident.io and ServiceNow webhooks
- **Rate Limiting**: Configurable request rate limiting and concurrent request controls
- **Comprehensive Logging**: Structured JSON logging with configurable levels
- **Health Monitoring**: Built-in health check endpoints for monitoring
- **Error Handling**: Robust error handling with retry mechanisms
- **Docker Support**: Containerized deployment with Docker Compose

## Quick Start

### Prerequisites
- Node.js 18+
- incident.io organization with API access
- ServiceNow instance with REST API access
- Docker and Docker Compose (optional, for containerized deployment)

### 1. Clone and Setup
```bash
git clone <repository-url>
cd incident-servicenow-sync
```

### 2. Configure the Integration

Copy the example configuration files:
```bash
cp config/config.example.json config/config.json
cp config/field-mappings.example.json config/field-mappings.json
```

### 3. Set Environment Variables

Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

Then edit your `.env` file with your actual values:
```bash
# incident.io Configuration
INCIDENT_IO_API_KEY=your_incident_io_api_key

# ServiceNow Configuration
SERVICENOW_INSTANCE_URL=https://your-instance.service-now.com
SERVICENOW_USERNAME=your_servicenow_username
SERVICENOW_PASSWORD=your_servicenow_password

# Server Configuration (REQUIRED)
PORT=3000

# Webhook Security
WEBHOOK_SECRET=your_incident_io_webhook_secret
WEBHOOK_VERIFY_SIGNATURE=false
SERVICENOW_WEBHOOK_SECRET=your_servicenow_webhook_secret
SERVICENOW_WEBHOOK_VERIFY_SIGNATURE=false

# Optional: ServiceNow Link Field (for adding ServiceNow links to incident.io)
SERVICENOW_LINK_FIELD_ID=your_custom_field_uuid

# Optional: External port for Docker (if different from internal port)
EXTERNAL_PORT=3000
```

### 4. Update Configuration Files

#### config/config.json
The configuration uses environment variable placeholders. You typically don't need to modify this file - just set the environment variables:
```json
{
  "servicenow": {
    "instance_url": "${SERVICENOW_INSTANCE_URL}",
    "incident_id_field": "u_incident_io_id"
  },
  "webhook": {
    "port": "${PORT}",
    "verify_signature": "${WEBHOOK_VERIFY_SIGNATURE}"
  }
}
```

#### config/field-mappings.json
**CRITICAL**: Update the severity UUIDs to match your incident.io organization:
```json
{
  "reverse_mappings": {
    "severity": {
      "1": "YOUR_CRITICAL_SEVERITY_UUID",
      "2": "YOUR_MAJOR_SEVERITY_UUID", 
      "3": "YOUR_MINOR_SEVERITY_UUID"
    }
  }
}
```

To find your severity UUIDs, use the incident.io API:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.incident.io/v1/severities
```

**Field Mapping Configuration:**
- **`config/field-mappings.json`** - Contains essential fields needed for bidirectional sync

The default configuration includes only the core fields required for production use. You can add additional field mappings as needed for your specific environment requirements.

### 5. Choose Your Deployment Method

## Option A: Docker Deployment (Recommended)

```bash
# Build and start the containers
docker-compose up -d

# View logs
docker-compose logs -f
```

## Option B: Native Node.js Deployment

### Install Dependencies
```bash
npm install --production
```

### Start the Application
```bash
# Using npm
npm start

# Or directly with Node.js
node src/index.js
```

### Process Management (Production)
For production environments without Docker, use a process manager:

**Using PM2:**
```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start src/index.js --name "incident-sync" --env production

# View logs
pm2 logs incident-sync

# Monitor
pm2 monit

# Auto-restart on server reboot
pm2 startup
pm2 save
```

**Using systemd (Linux):**
Create a systemd service file `/etc/systemd/system/incident-sync.service`:
```ini
[Unit]
Description=Incident.io ServiceNow Sync
After=network.target

[Service]
Type=simple
User=your-app-user
WorkingDirectory=/path/to/incident-servicenow-sync
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=incident-sync
Environment=NODE_ENV=production
EnvironmentFile=/path/to/incident-servicenow-sync/.env

[Install]
WantedBy=multi-user.target
```

Then enable and start the service:
```bash
sudo systemctl enable incident-sync
sudo systemctl start incident-sync
sudo systemctl status incident-sync
```

### Reverse Proxy Setup (Nginx)
For production deployments, use a reverse proxy to handle SSL and routing:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /path/to/your/certificate.crt;
    ssl_certificate_key /path/to/your/private.key;
    
    location / {
        proxy_pass http://127.0.0.1:3000;  # Replace 3000 with your PORT value
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 6. Configure Webhooks

#### incident.io Webhook
1. Go to Settings → Webhooks in your incident.io dashboard
2. Create a new webhook with URL: `https://your-domain.com/webhook`
3. Select events: `incident_created_v2`, `incident_updated_v2`, `incident_status_updated_v2`
4. Set the webhook secret (must match `WEBHOOK_SECRET` environment variable)

#### ServiceNow Business Rule
Create a Business Rule in ServiceNow to send webhooks on incident updates:

**Name**: `incident.io Sync Webhook`  
**Table**: `incident`  
**When**: `after`  
**Update**: ✅ Checked  
**Conditions**: `incident.io Id` `is not empty`

**Script**:
```javascript
(function executeRule(current, previous) {

      // Only process incidents that have an incident.io ID
      if (!current.u_incident_io_id || current.u_incident_io_id.isEmpty()) {
          gs.info('Incident.io sync: Skipping incident without incident.io ID - ' + current.number);
          return;
      }

      // Check if any relevant fields changed
      var relevantFields = ['short_description', 'description', 'work_notes', 'incident_state', 'urgency', 'impact', 'priority'];
      var changedFields = [];
      var oldValues = {};

      for (var i = 0; i < relevantFields.length; i++) {
          var field = relevantFields[i];
          if (current[field].changes()) {
              changedFields.push(field);
              oldValues[field] = previous[field].toString();
          }
      }

      // If no relevant fields changed, don't send webhook
      if (changedFields.length === 0) {
          gs.info('Incident.io sync: No relevant fields changed for incident ' + current.number);
          return;
      }

      // Prepare webhook payload
      var payload = {
          sys_id: current.sys_id.toString(),
          table: 'incident',
          operation: 'update',
          number: current.number.toString(),
          incident_io_id: current.u_incident_io_id.toString(),
          updated_fields: changedFields,
          old_values: oldValues,
          new_values: {
              short_description: current.short_description.toString(),
              description: current.description.toString(),
              work_notes: current.work_notes.toString(),
              incident_state: current.incident_state.toString(),
              urgency: current.urgency.toString(),
              impact: current.impact.toString(),
              priority: current.priority.toString()
          },
          updated_by: current.sys_updated_by.toString(),
          updated_on: current.sys_updated_on.toString()
      };

      gs.info('Incident.io sync: Sending webhook for incident ' + current.number +
              ', changed fields: ' + changedFields.join(', '));

      // Send webhook notification
      try {
          var restMessage = new sn_ws.RESTMessageV2();

          // IMPORTANT: Replace with your actual webhook URL
          // If testing locally with ngrok: https://your-ngrok-url.ngrok-free.app/webhook/servicenow
          // If production: https://your-production-url.com/webhook/servicenow
          restMessage.setEndpoint('your_webhook/webhook/servicenow');

          restMessage.setHttpMethod('POST');
          restMessage.setRequestHeader('Content-Type', 'application/json');

          // Optional: Add authentication if you enabled signature verification
          // restMessage.setRequestHeader('X-ServiceNow-Signature', generateSignature(JSON.stringify(payload)));

          restMessage.setRequestBody(JSON.stringify(payload));

          var response = restMessage.execute();
          var responseBody = response.getBody();
          var httpStatus = response.getStatusCode();

          if (httpStatus == 200) {
              gs.info('Incident.io webhook sent successfully: ' + httpStatus + ' - ' + responseBody);
          } else {
              gs.error('Incident.io webhook failed: ' + httpStatus + ' - ' + responseBody);
          }

      } catch (ex) {
          gs.error('Failed to send incident.io webhook: ' + ex.getMessage());
      }

})(current, previous);
```

### 7. Verify Setup

Check the health endpoint:
```bash
# For local deployment:
curl http://localhost:$PORT/health

# For remote deployment:
curl https://your-domain.com/health
```

Test the integration by creating an incident in incident.io and verifying it appears in ServiceNow, then updating the ServiceNow incident and verifying the changes sync back to incident.io.

## Configuration Reference

### Core Settings (config/config.json)

| Setting | Description | Required |
|---------|-------------|----------|
| `servicenow.instance_url` | Your ServiceNow instance URL (use SERVICENOW_INSTANCE_URL env var) | ✅ |
| `servicenow.incident_id_field` | ServiceNow field to store incident.io ID | ✅ |
| `incident_io.api_key` | incident.io API key (via env var) | ✅ |
| `webhook.port` | Port for webhook server | ❌ (use PORT env var instead) |
| `webhook.verify_signature` | Enable webhook signature verification (use WEBHOOK_VERIFY_SIGNATURE env var) | ❌ (default: false) |
| `features.reverse_sync` | Enable ServiceNow → incident.io sync | ❌ (default: true) |
| `features.sync_status` | Enable status synchronization | ❌ (default: true) |
| `features.sync_severity` | Enable severity synchronization | ❌ (default: true) |

### Field Mappings (config/field-mappings.json)

The field mappings configuration controls how data is transformed between systems:

#### Forward Sync Mappings
- `incident_creation`: Maps incident.io fields to ServiceNow fields when creating incidents
- `incident_updates`: Maps incident.io fields to ServiceNow fields when updating incidents

#### Reverse Sync Mappings
- `reverse_mappings.severity`: Maps ServiceNow priority (1-5) to incident.io severity UUIDs
- `reverse_mappings.status`: Maps ServiceNow incident_state to incident.io status IDs

**IMPORTANT**: All UUIDs in the reverse mappings must match your incident.io organization's actual UUIDs. These can be found via the incident.io API.

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `INCIDENT_IO_API_KEY` | incident.io API key | ✅ |
| `SERVICENOW_INSTANCE_URL` | ServiceNow instance URL | ✅ |
| `SERVICENOW_USERNAME` | ServiceNow username | ✅ |
| `SERVICENOW_PASSWORD` | ServiceNow password | ✅ |
| `WEBHOOK_SECRET` | Secret for incident.io webhook verification | ❌ |
| `WEBHOOK_VERIFY_SIGNATURE` | Enable incident.io webhook signature verification | ❌ (default: false) |
| `SERVICENOW_WEBHOOK_SECRET` | Secret for ServiceNow webhook verification | ❌ |
| `SERVICENOW_WEBHOOK_VERIFY_SIGNATURE` | Enable ServiceNow webhook signature verification | ❌ (default: false) |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | ❌ (default: info) |
| `SERVICENOW_LINK_FIELD_ID` | Custom field UUID for ServiceNow links ([see setup guide](#servicenow-link-field-optional)) | ❌ |
| `SERVICENOW_INSTANCE_URL` | ServiceNow instance URL for links | ❌ |
| `PORT` | Webhook server port | ✅ |

## ServiceNow Setup

### Required Custom Fields

You must create these custom fields in your ServiceNow incident table:

#### Step-by-Step Instructions:
1. Navigate to **System Definition → Tables**
2. Find and open the **Incident [incident]** table
3. Go to the **Columns** tab
4. Click **New** to create each field

#### Field 1: u_incident_io_id (REQUIRED)
```
Column label: Incident.io ID
Column name: u_incident_io_id
Type: String
Max length: 40
Unique: ✅ Checked (critical for preventing duplicates)
Display: ✅ Checked
```
- **Purpose**: Store the incident.io incident ID for linking records
- **Critical**: This field is required for bidirectional sync to work

### ServiceNow Link Field (Optional)

If you want to automatically add ServiceNow links to your incident.io incidents, you need to:

#### Step 1: Create a Custom Field in incident.io
1. Go to **Settings → Custom Fields** in your incident.io dashboard
2. Click **New Custom Field**
3. Configure the field:
   ```
   Field name: ServiceNow Link
   Field type: Link
   Description: Link to ServiceNow incident record
   Show in incident header: ✅ (recommended)
   ```
4. Click **Create**

#### Step 2: Get the Custom Field UUID
1. After creating the field, go to **Settings → Custom Fields**
2. Click on your "ServiceNow Link" field
3. Copy the UUID from the browser URL (e.g., `01234567-89ab-cdef-0123-456789abcdef`)
4. Set this as your `SERVICENOW_LINK_FIELD_ID` environment variable

#### Step 3: Enable the Feature
1. Set `SERVICENOW_LINK_FIELD_ID=your_copied_uuid` in your `.env` file
2. Ensure `SERVICENOW_INSTANCE_URL=https://your-instance.service-now.com` is set
3. The integration will automatically add ServiceNow links to new incidents


## Troubleshooting

### Common Issues

**1. "No incident.io ID found in ServiceNow record"**
- Cause: ServiceNow incident doesn't have the incident.io ID field populated
- Solution: Verify the custom field `u_incident_io_id` exists and is being populated during incident creation

**2. "Cannot change status of an incident to a non-active status"**
- Cause: incident.io workflow rules prevent certain status transitions
- Solution: The integration only maps to "live" statuses (Investigating, Fixing, Monitoring). This is by design.

**3. "Invalid severity mapping for ServiceNow priority"**
- Cause: Severity UUIDs in field-mappings.json don't match your incident.io organization
- Solution: Update the UUIDs in `reverse_mappings.severity` with your organization's actual severity UUIDs

**4. Webhook signature verification failures**
- Cause: Webhook secrets don't match between systems
- Solution: Ensure `WEBHOOK_SECRET` matches the secret configured in incident.io webhook settings

### Debugging

Enable debug logging:
```bash
export LOG_LEVEL=debug
docker-compose restart
```

View detailed logs:
```bash
docker-compose logs -f --tail=100
```

Check application health:
```bash
# For local deployment:
curl http://localhost:$PORT/health

# For remote deployment:
curl https://your-domain.com/health
```

### Log Analysis

The application logs all sync operations with structured data. Key log entries to monitor:

- **Successful sync**: `"Successfully synced ServiceNow changes to incident.io"`
- **Loop prevention**: `"Skipping forward sync due to recent reverse sync"`
- **Mapping issues**: `"No severity mapping found for ServiceNow priority"`
- **API errors**: `"Failed to sync ServiceNow changes to incident.io"`

## Support

For issues and questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review application logs for specific error messages
3. Verify your configuration matches the examples
4. Ensure all required environment variables are set
5. Test API connectivity to both incident.io and ServiceNow

## Security Considerations

- Enable webhook signature verification in production
- Use strong, unique webhook secrets
- Restrict network access to the webhook endpoints
- Regularly rotate API keys and passwords
- Monitor logs for unauthorized access attempts
- Use HTTPS for all webhook endpoints


```json
{
  "servicenow": {
    "instance_url": "https://your-instance.service-now.com",
    "table": "incident",
    "incident_id_field": "u_incident_io_id"
  },
  "incident_io": {
    "api_url": "https://api.incident.io/v2"
  },
  "webhook": {
    "port": "${PORT}",
    "path": "/webhook",
    "verify_signature": true
  },
  "logging": {
    "level": "info"
  }
}
```

### Field Mapping (`config/field-mappings.json`)

```json
{
  "incident_creation": {
    "short_description": {
      "source": "incident.name",
      "type": "text"
    },
    "description": {
      "source": "incident.summary",
      "type": "text"
    },
    "assigned_to": {
      "source": "incident.incident_lead.name",
      "type": "user_lookup",
      "lookup_field": "name"
    },
    "service": {
      "source": "incident.incident_type.name",
      "type": "reference_lookup",
      "lookup_table": "cmdb_ci_service",
      "lookup_field": "name"
    },
    "urgency": {
      "source": "incident.severity",
      "type": "choice_mapping",
      "mappings": {
        "critical": "1",
        "high": "2",
        "medium": "3",
        "low": "3"
      }
    }
  },
  "incident_updates": {
    "work_notes": {
      "source": "incident_update.message",
      "type": "text",
      "deduplicate": true
    },
    "state": {
      "source": "incident.status",
      "type": "choice_mapping",
      "mappings": {
        "investigating": "2",
        "identified": "2", 
        "monitoring": "3",
        "resolved": "6",
        "closed": "7"
      }
    }
  }
}
```

## Field Mapping Types

- **`text`** - Direct text mapping
- **`user_lookup`** - Look up ServiceNow user by name/email
- **`reference_lookup`** - Look up reference by name in specified table
- **`choice_mapping`** - Map values using predefined mappings
- **`expression`** - Use JavaScript expressions for complex mappings

## ServiceNow Setup

Create a custom field in your ServiceNow incident table:
- Field name: `u_incident_io_id` 
- Type: String
- Label: "Incident.io ID"

## Documentation

- [Setup Guide](docs/SETUP.md) - Detailed setup instructions
- [Field Mapping Guide](docs/FIELD_MAPPING.md) - Configure custom field mappings  
- [API Reference](docs/API.md) - Webhook and REST API documentation
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions

## Health Check

`GET /health` - Returns service status and configuration info

## Requirements

- Node.js 18+
- ServiceNow instance with REST API access
- incident.io organization with API access
- HTTPS endpoint for webhook reception

## License

MIT License - see [LICENSE](LICENSE) for details.