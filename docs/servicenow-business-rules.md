# ServiceNow Business Rules Setup

This document explains how to set up ServiceNow Business Rules to enable bi-directional synchronization from ServiceNow to incident.io.

## Overview

To enable reverse sync (ServiceNow → incident.io), you need to create Business Rules in ServiceNow that detect when incident records are updated and send webhook notifications to your integration.

## Required Business Rule

### 1. Create the Business Rule

1. Navigate to **System Definition > Business Rules** in ServiceNow
2. Click **New** to create a new Business Rule
3. Configure the following fields:

**Basic Information:**
- **Name**: `Incident.io Sync - Send Update`
- **Table**: `Incident [incident]`
- **Active**: `true`
- **Advanced**: `true`

**When to run:**
- **When**: `after`
- **Order**: `100`
- **Insert**: `false`
- **Update**: `true`  
- **Delete**: `false`
- **Query**: `false`

**Advanced Settings:**
- **Condition**: Leave blank or add: `u_incident_io_id.isNotEmpty()` (only sync incidents that came from incident.io)

### 2. Business Rule Script

Add the following script to the **Script** field:

```javascript
(function executeRule(current, previous) {
    
    // Only process incidents that have an incident.io ID
    if (!current.u_incident_io_id || current.u_incident_io_id.isEmpty()) {
        return;
    }
    
    // Check if any relevant fields changed
    var relevantFields = ['short_description', 'description', 'work_notes', 'incident_state', 'priority'];
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
            priority: current.priority.toString()
        },
        updated_by: current.sys_updated_by.toString(),
        updated_on: current.sys_updated_on.toString()
    };
    
    // Send webhook notification
    try {
        var restMessage = new sn_ws.RESTMessageV2();
        restMessage.setEndpoint('YOUR_INTEGRATION_URL/webhook/servicenow');
        restMessage.setHttpMethod('POST');
        restMessage.setRequestHeader('Content-Type', 'application/json');
        
        // Add authentication if needed
        // restMessage.setRequestHeader('X-ServiceNow-Signature', generateSignature(JSON.stringify(payload)));
        
        restMessage.setRequestBody(JSON.stringify(payload));
        
        var response = restMessage.execute();
        var responseBody = response.getBody();
        var httpStatus = response.getStatusCode();
        
        gs.info('Incident.io webhook sent: ' + httpStatus + ' - ' + responseBody);
        
    } catch (ex) {
        gs.error('Failed to send incident.io webhook: ' + ex.getMessage());
    }
    
})(current, previous);
```

### 3. Configuration Variables

Replace `YOUR_INTEGRATION_URL` in the script with your actual integration URL (e.g., `https://your-ngrok-url.ngrok-free.app` or your production URL).

## Optional Enhancements

### 1. Add Signature Verification

If you want to verify webhook signatures, add this function to your Business Rule:

```javascript
function generateSignature(payload) {
    // You'll need to implement HMAC-SHA256 signature generation
    // This requires a shared secret between ServiceNow and your integration
    var secret = 'YOUR_WEBHOOK_SECRET';
    // Implementation depends on your ServiceNow version and available crypto functions
    return 'sha256=' + hmacSha256(payload, secret);
}
```

### 2. Add Error Handling and Retry Logic

For production use, consider adding:
- Retry logic for failed webhook calls
- Dead letter queue for persistent failures
- Monitoring and alerting for webhook failures

### 3. Field-Specific Business Rules

You can create separate Business Rules for different types of changes:

- **Title/Description Changes**: Only trigger on `short_description` or `description` changes
- **Status Changes**: Only trigger on `incident_state` changes
- **Work Notes**: Only trigger on `work_notes` changes

## Testing the Business Rule

1. Update an incident in ServiceNow that has a `u_incident_io_id` value
2. Check the System Logs for the webhook response
3. Verify that the integration receives and processes the webhook
4. Confirm that changes appear in incident.io

## Troubleshooting

### Common Issues

1. **Business Rule not triggering**:
   - Check that the Business Rule is Active
   - Verify the Table is set to "Incident [incident]"
   - Ensure "Update" is checked in the When to run section

2. **Webhook not received**:
   - Verify the endpoint URL is correct and accessible
   - Check ServiceNow System Logs for error messages
   - Test the endpoint manually with a REST client

3. **Integration not processing webhook**:
   - Check integration logs for errors
   - Verify the payload format matches expected structure
   - Test with manual webhook calls using the `/sync/servicenow/:sysId` endpoint

### Debug Information

Add debug logging to your Business Rule:

```javascript
gs.info('Incident.io sync - Processing update for: ' + current.number + 
        ', Fields changed: ' + changedFields.join(', '));
```

## Security Considerations

1. **Network Access**: Ensure ServiceNow can reach your integration endpoint
2. **Authentication**: Implement webhook signature verification for security
3. **Rate Limiting**: Consider rate limiting to prevent overwhelming your integration
4. **Field Filtering**: Only sync fields that should be synchronized to prevent data leakage

## Performance Notes

- Business Rules run synchronously and can slow down ServiceNow operations
- Consider using **async** Business Rules for non-critical webhooks
- Monitor webhook response times and optimize accordingly
- Use field conditions to minimize unnecessary webhook calls