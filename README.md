# Incident.io ↔ ServiceNow Integration

An open-source, self-hosted integration that synchronizes incidents between incident.io and ServiceNow. This replaces the need for Zapier or other third-party automation tools.

## Features

- **Real-time synchronization** - Webhook-based updates from incident.io
- **Flexible field mapping** - Configure custom field mappings via JSON
- **ServiceNow ID resolution** - Automatically resolve reference fields by name
- **Deduplication** - Prevents duplicate work notes and updates
- **Configurable workflows** - Handle incident creation and updates separately
- **Comprehensive logging** - Detailed logs for troubleshooting
- **Docker support** - Easy deployment with Docker
- **Production ready** - Error handling, retries, and monitoring

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/incident-servicenow-sync.git
   cd incident-servicenow-sync
   ```

2. **Copy and configure**
   ```bash
   cp config/config.example.json config/config.json
   cp config/field-mappings.example.json config/field-mappings.json
   ```

3. **Set environment variables**
   ```bash
   export INCIDENT_IO_API_KEY="your_incident_io_api_key"
   export SERVICENOW_USERNAME="your_servicenow_username"
   export SERVICENOW_PASSWORD="your_servicenow_password"
   export WEBHOOK_SECRET="your_webhook_secret"
   ```

4. **Run with Docker**
   ```bash
   docker-compose up -d
   ```

5. **Configure webhook in incident.io**
   - URL: `https://your-domain.com/webhook`
   - Events: `public_incident.incident_created_v2`, `public_incident.incident_updated_v2`

## Configuration

### Basic Configuration (`config/config.json`)

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
    "port": 5002,
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