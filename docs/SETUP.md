# Setup Guide

This guide walks you through setting up the incident.io to ServiceNow integration from start to finish.

## Prerequisites

- **Node.js 18+** installed on your system
- **ServiceNow instance** with admin access
- **incident.io organization** with API access
- **HTTPS endpoint** for receiving webhooks (for production)

## Step 1: Clone and Install

```bash
git clone https://github.com/your-org/incident-servicenow-sync.git
cd incident-servicenow-sync
npm install
```

## Step 2: ServiceNow Setup

### Create Custom Field

1. Navigate to **System Definition > Tables**
2. Find and open the **Incident [incident]** table
3. Go to the **Columns** tab
4. Create a new column:
   - **Column label**: `Incident.io ID`
   - **Column name**: `u_incident_io_id`
   - **Type**: `String`
   - **Max length**: `50`

### Create Integration User (Recommended)

1. Navigate to **User Administration > Users**
2. Create a new user for the integration:
   - **User ID**: `incident.io.integration`
   - **First name**: `Incident.io`
   - **Last name**: `Integration`
   - **Email**: Your notification email
3. Assign roles:
   - `incident_manager` (for incident CRUD operations)
   - `web_service_admin` (for API access)

## Step 3: incident.io Setup

### Get API Key

1. Go to **Settings > API keys** in your incident.io dashboard
2. Create a new **Private key**
3. Copy the key (you'll need this for configuration)

### Create Webhook (Do this after deployment)

1. Go to **Settings > Webhooks**
2. Click **Add webhook**
3. Configure:
   - **URL**: `https://your-domain.com/webhook`
   - **Description**: `ServiceNow Integration`
   - **Events**: Select:
     - `public_incident.incident_created_v2`
     - `public_incident.incident_updated_v2`
   - **Secret**: Generate a secure random string (save this)

## Step 4: Configuration

### Copy Example Files

```bash
cp config/config.example.json config/config.json
cp config/field-mappings.example.json config/field-mappings.json
cp .env.example .env
```

### Configure Environment Variables

Edit `.env`:

```bash
# incident.io Configuration
INCIDENT_IO_API_KEY=your_incident_io_private_api_key

# ServiceNow Configuration  
SERVICENOW_USERNAME=incident.io.integration
SERVICENOW_PASSWORD=your_password

# Webhook Configuration
WEBHOOK_SECRET=your_webhook_secret

# Optional
PORT=5002
LOG_LEVEL=info
```

### Configure ServiceNow Instance

Edit `config/config.json`:

```json
{
  "servicenow": {
    "instance_url": "https://your-instance.service-now.com",
    "table": "incident",
    "incident_id_field": "u_incident_io_id"
  }
}
```

### Configure Field Mappings

Edit `config/field-mappings.json` to customize how incident.io fields map to ServiceNow fields. See [Field Mapping Guide](FIELD_MAPPING.md) for details.

## Step 5: Deployment Options

### Option A: Local Development

```bash
npm run dev
```

The server will start on `http://localhost:5002`.

For webhook testing, use a tunnel service:
```bash
# Install ngrok
npm install -g ngrok

# Create tunnel
ngrok http 5002

# Use the HTTPS URL for your webhook
```

### Option B: Docker Deployment

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f incident-sync

# Stop
docker-compose down
```

### Option C: Cloud Deployment

#### Railway
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

1. Fork this repository
2. Connect to Railway
3. Set environment variables in Railway dashboard
4. Deploy

#### Other Platforms
- **Heroku**: Use the included `Procfile`
- **AWS**: Deploy as Lambda function or ECS container
- **DigitalOcean**: Use App Platform or Droplets
- **Google Cloud**: Use Cloud Run or Compute Engine

## Step 6: Validation

### Test Configuration

```bash
npm run validate-config
```

### Health Check

```bash
npm run health-check
```

Or visit: `http://your-domain.com/health`

### Test Webhook

```bash
curl -X POST http://localhost:5002/webhook \
  -H "Content-Type: application/json" \
  -H "X-Incident-Signature: sha256=test" \
  -d '{
    "event_type": "public_incident.incident_created_v2",
    "data": {
      "incident": {
        "id": "test-incident-123",
        "name": "Test Incident",
        "status": "investigating"
      }
    }
  }'
```

## Step 7: Configure incident.io Webhook

Now that your integration is deployed and accessible via HTTPS:

1. Go back to **incident.io Settings > Webhooks**
2. Update the webhook URL to point to your deployed service
3. Test the webhook by creating a test incident in incident.io

## Troubleshooting

### Common Issues

**"Connection refused" errors**
- Check that ServiceNow instance URL is correct
- Verify network connectivity to ServiceNow
- Ensure ServiceNow credentials are valid

**"Webhook signature verification failed"**
- Check that `WEBHOOK_SECRET` matches the secret in incident.io
- Ensure webhook is sending to the correct endpoint

**"Field mapping errors"**
- Review field mapping configuration
- Check ServiceNow field names and types
- Verify required fields are mapped

**"Rate limit exceeded"**
- Adjust `performance.rate_limit` in config
- Consider implementing request queuing

### Logs

Check application logs for detailed error information:

```bash
# Docker
docker-compose logs -f incident-sync

# Local
tail -f logs/app.log
```

### Support

- Check [Troubleshooting Guide](TROUBLESHOOTING.md)
- Review [API Documentation](API.md)
- Open an issue on GitHub

## Next Steps

- Customize field mappings for your specific needs
- Set up monitoring and alerting
- Configure backup webhooks for reliability
- Implement additional notification channels

## Security Considerations

- Use HTTPS for all webhook endpoints
- Rotate API keys and secrets regularly  
- Monitor for suspicious activity
- Limit ServiceNow user permissions to minimum required
- Consider IP whitelisting for additional security