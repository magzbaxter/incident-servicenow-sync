/**
 * ServiceNow to incident.io Reverse Synchronization Handler
 * 
 * This class handles the synchronization of incident updates from ServiceNow to incident.io.
 * It processes ServiceNow webhook notifications and applies corresponding updates to incident.io incidents.
 * 
 * KEY RESPONSIBILITIES:
 * - Process ServiceNow incident update notifications
 * - Map ServiceNow field changes to incident.io format
 * - Handle priority/urgency/impact to severity mapping
 * - Prevent synchronization loops with cooldown mechanisms
 * - Support bulk update operations with rate limiting
 * 
 * FIELD MAPPINGS:
 * - ServiceNow priority (1-5) → incident.io severity (Critical/Major/Minor)
 * - ServiceNow incident_state → incident.io status (workflow-compliant only)
 * - ServiceNow short_description → incident.io name  
 * - ServiceNow description → incident.io summary
 * - ServiceNow work_notes → incident.io updates/comments
 * 
 * STATUS MAPPING LIMITATIONS:
 * incident.io enforces workflow rules that only allow transitions between "live" statuses
 * (Investigating, Fixing, Monitoring). Transitions to Triage, Paused, Closed, etc. are blocked
 * by the platform. The mapping uses the closest allowed status for each ServiceNow state.
 * 
 * CONFIGURATION:
 * All field mappings are configured in config/field-mappings.json under the
 * "reverse_mappings" section. Severity UUIDs must match your incident.io organization.
 */
class ReverseSyncHandler {
  constructor(serviceNowClient, incidentIOClient, config, logger, fieldMapper = null, incidentHandler = null) {
    this.serviceNowClient = serviceNowClient;
    this.incidentIOClient = incidentIOClient;
    this.config = config;
    this.logger = logger;
    this.fieldMapper = fieldMapper;
    this.incidentHandler = incidentHandler;
    
    // Track processing to prevent loops
    this.processingUpdates = new Set();
  }

  /**
   * Handle ServiceNow incident update
   */
  async handleServiceNowUpdate(sysId, updatedFields, oldValues = {}) {
    this.logger.info('Processing ServiceNow → incident.io sync', { 
      sys_id: sysId,
      updated_fields: updatedFields
    });

    // Prevent processing loops
    const lockKey = `${sysId}-${Date.now()}`;
    if (this.processingUpdates.has(sysId)) {
      this.logger.warn('ServiceNow update already in progress, skipping', { sys_id: sysId });
      return;
    }

    this.processingUpdates.add(sysId);

    try {
      // Get the incident.io ID from ServiceNow record
      const incidentIOId = await this.serviceNowClient.getIncidentIOIdFromServiceNow(sysId);
      if (!incidentIOId) {
        this.logger.warn('No incident.io ID found in ServiceNow record, skipping sync', { 
          sys_id: sysId 
        });
        return;
      }

      // Get full ServiceNow incident data
      const serviceNowIncident = await this.serviceNowClient.getIncidentBySysId(sysId);
      if (!serviceNowIncident) {
        this.logger.error('ServiceNow incident not found', { sys_id: sysId });
        return;
      }

      // Map ServiceNow changes to incident.io updates
      const incidentIOUpdates = await this.mapServiceNowToIncidentIO(
        serviceNowIncident, 
        updatedFields, 
        oldValues
      );

      if (Object.keys(incidentIOUpdates).length === 0) {
        this.logger.info('No mappable changes found, skipping sync', { 
          sys_id: sysId,
          incident_io_id: incidentIOId
        });
        return;
      }

      // Apply updates to incident.io
      await this.applyIncidentIOUpdates(incidentIOId, incidentIOUpdates, serviceNowIncident);

      this.logger.info('Successfully synced ServiceNow changes to incident.io', {
        sys_id: sysId,
        incident_io_id: incidentIOId,
        updated_fields: Object.keys(incidentIOUpdates)
      });

      // Track this reverse sync to prevent forward sync loops
      if (this.incidentHandler) {
        this.incidentHandler.trackReverseSyncUpdate(incidentIOId);
      }

    } catch (error) {
      this.logger.error('Failed to sync ServiceNow changes to incident.io', {
        sys_id: sysId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      this.processingUpdates.delete(sysId);
    }
  }

  /**
   * Map ServiceNow field changes to incident.io updates
   */
  async mapServiceNowToIncidentIO(serviceNowIncident, updatedFields, oldValues) {
    const updates = {};

    // Map short_description to incident.io title/name
    if (updatedFields.includes('short_description') && serviceNowIncident.short_description) {
      updates.name = serviceNowIncident.short_description;
      this.logger.debug('Mapping short_description to incident.io name', {
        old_value: oldValues.short_description,
        new_value: serviceNowIncident.short_description
      });
    }

    // Map description to incident.io summary
    if (updatedFields.includes('description') && serviceNowIncident.description) {
      updates.summary = serviceNowIncident.description;
      this.logger.debug('Mapping description to incident.io summary', {
        old_value: oldValues.description,
        new_value: serviceNowIncident.description
      });
    }

    // Map work_notes to incident.io updates (as comments)
    if (updatedFields.includes('work_notes') && serviceNowIncident.work_notes) {
      // Only sync new work notes (not the entire history)
      const newWorkNotes = this.extractNewWorkNotes(
        serviceNowIncident.work_notes, 
        oldValues.work_notes
      );
      
      if (newWorkNotes) {
        updates.add_update = {
          message: `ServiceNow Work Note: ${newWorkNotes}`,
          update_type: 'update'
        };
        this.logger.debug('Mapping work_notes to incident.io update', {
          new_notes: newWorkNotes
        });
      }
    }

    // Map status changes (if configured)
    if (this.config.features?.sync_status && updatedFields.includes('incident_state')) {
      const incidentIOStatus = this.mapServiceNowStatusToIncidentIO(serviceNowIncident.incident_state);
      if (incidentIOStatus) {
        // incident.io API for /actions/edit expects incident_status_id as a string
        updates.incident_status_id = incidentIOStatus.id;
        this.logger.info('Mapping incident_state to incident.io status', {
          servicenow_state: serviceNowIncident.incident_state,
          incident_io_status: incidentIOStatus,
          incident_status_id: incidentIOStatus.id,
          status_object: JSON.stringify(incidentIOStatus)
        });
      }
    }

    // Map urgency/impact to severity changes (if configured)
    if (this.config.features?.sync_severity && 
        (updatedFields.includes('urgency') || updatedFields.includes('impact') || updatedFields.includes('priority'))) {
      
      // Use priority if available, otherwise calculate from urgency/impact
      let priorityValue = serviceNowIncident.priority;
      if (!priorityValue && serviceNowIncident.urgency && serviceNowIncident.impact) {
        // ServiceNow typically calculates priority as min(urgency, impact)
        priorityValue = Math.min(parseInt(serviceNowIncident.urgency), parseInt(serviceNowIncident.impact)).toString();
      }
      
      if (priorityValue) {
        const incidentIOSeverity = this.mapServiceNowPriorityToIncidentIO(priorityValue);
        if (incidentIOSeverity) {
          // incident.io API expects severity_id as a string, not severity as an object
          updates.severity_id = incidentIOSeverity.id;
          this.logger.info('Mapping urgency/impact/priority to incident.io severity', {
            servicenow_urgency: serviceNowIncident.urgency,
            servicenow_impact: serviceNowIncident.impact,
            servicenow_priority: priorityValue,
            incident_io_severity: incidentIOSeverity,
            severity_object: JSON.stringify(incidentIOSeverity)
          });
        }
      }
    }

    return updates;
  }

  /**
   * Apply the mapped updates to incident.io
   */
  async applyIncidentIOUpdates(incidentIOId, updates, serviceNowIncident) {
    // Handle basic field updates
    const basicUpdates = { ...updates };
    delete basicUpdates.add_update;

    if (Object.keys(basicUpdates).length > 0) {
      await this.incidentIOClient.updateIncident(incidentIOId, basicUpdates);
    }

    // Handle adding updates/comments separately
    if (updates.add_update) {
      const updateOptions = {};
      if (updates.incident_status) updateOptions.status = updates.incident_status;
      if (updates.severity) updateOptions.severity = updates.severity;

      await this.incidentIOClient.addIncidentUpdate(
        incidentIOId, 
        updates.add_update.message,
        updateOptions
      );
    }
  }

  /**
   * Extract only new work notes from the full work notes field
   */
  extractNewWorkNotes(fullWorkNotes, oldWorkNotes) {
    if (!fullWorkNotes) return null;
    if (!oldWorkNotes) return fullWorkNotes;

    // ServiceNow typically appends new notes to the top
    // This is a simplified approach - you might need to adjust based on your ServiceNow configuration
    const newNotesLength = fullWorkNotes.length - oldWorkNotes.length;
    if (newNotesLength > 0) {
      return fullWorkNotes.substring(0, newNotesLength).trim();
    }

    return null;
  }

  /**
   * Map ServiceNow incident state to incident.io status object
   */
  mapServiceNowStatusToIncidentIO(serviceNowState) {
    // Only use transitions that are ALLOWED by incident.io workflow rules
    // incident.io only allows transitions between "live" category statuses
    const statusMapping = {
      '1': { id: '01JT3NNT3D4J0DDWS19MQYF0RC' },   // New -> Investigating (can't use Triage)
      '2': { id: '01JT3NNT3D4J0DDWS19MQYF0RC' },   // In Progress -> Investigating  
      '3': { id: '01JT3NNT3D455EB53SWJHK1QST' },   // On Hold -> Monitoring (closest to paused)
      '6': { id: '01JT3NNT3D73EK2RXFW4GJY310' },   // Resolved -> Fixing (can't use Closed)
      '7': { id: '01JT3NNT3D73EK2RXFW4GJY310' },   // Closed -> Fixing (can't use Closed)
      '8': { id: '01JT3NNT3D73EK2RXFW4GJY310' }    // Canceled -> Fixing (can't use Canceled)
    };

    // Use field mapper's reverse mappings if available
    if (this.fieldMapper?.mappingsConfig?.reverse_mappings?.status) {
      const statusId = this.fieldMapper.mappingsConfig.reverse_mappings.status[serviceNowState];
      return statusId ? { id: statusId } : statusMapping[serviceNowState];
    }

    return statusMapping[serviceNowState];
  }

  /**
   * Map ServiceNow priority to incident.io severity object
   * 
   * This method maps ServiceNow priority values (1-5) to incident.io severity UUIDs.
   * The mapping is configured in config/field-mappings.json under "reverse_mappings.severity"
   * 
   * MAPPING CONFIGURATION:
   * - Priority 1 (Critical) → Critical severity UUID
   * - Priority 2 (High) → Major severity UUID  
   * - Priority 3-5 (Medium/Low/Planning) → Minor severity UUID
   * 
   * SETUP INSTRUCTIONS:
   * 1. The severity UUIDs in field-mappings.json must match your incident.io organization
   * 2. You can find your organization's severity UUIDs via the incident.io catalog API
   * 3. See the field-mappings.json file for the current configured mappings
   */
  mapServiceNowPriorityToIncidentIO(serviceNowPriority) {

    // Use configured mappings from field-mappings.json if available
    if (this.fieldMapper?.mappingsConfig?.reverse_mappings?.severity) {
      const severityId = this.fieldMapper.mappingsConfig.reverse_mappings.severity[serviceNowPriority];
      if (severityId) {
        const mappedSeverity = { id: severityId };
        
        this.logger.debug('ServiceNow priority mapped to incident.io severity', {
          servicenow_priority: serviceNowPriority,
          incident_io_severity_id: severityId,
          mapping_source: 'field_mappings_config'
        });
        
        return mappedSeverity;
      }
    }

    // Fallback to default mapping
    const mappedSeverity = defaultSeverityMapping[serviceNowPriority];
    
    if (!mappedSeverity) {
      this.logger.warn('No severity mapping found for ServiceNow priority', {
        servicenow_priority: serviceNowPriority,
        available_priorities: Object.keys(defaultSeverityMapping),
        mapping_note: 'Please configure severity mappings in config/field-mappings.json'
      });
      return null;
    }

    this.logger.debug('ServiceNow priority mapped to incident.io severity', {
      servicenow_priority: serviceNowPriority,
      incident_io_severity_id: mappedSeverity.id,
      mapping_source: 'default_fallback'
    });

    return mappedSeverity;
  }

  /**
   * Handle bulk ServiceNow updates (for batch processing)
   */
  async handleBulkServiceNowUpdates(updates) {
    this.logger.info('Processing bulk ServiceNow → incident.io sync', { 
      count: updates.length 
    });

    const results = {
      successful: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    // Process updates with controlled concurrency
    const concurrency = this.config.performance?.concurrent_requests || 3;
    const chunks = [];
    
    for (let i = 0; i < updates.length; i += concurrency) {
      chunks.push(updates.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(async (update) => {
        try {
          await this.handleServiceNowUpdate(
            update.sys_id, 
            update.updated_fields, 
            update.old_values
          );
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            sys_id: update.sys_id,
            error: error.message
          });
        }
      });

      await Promise.all(promises);

      // Rate limiting delay
      if (this.config.performance?.rate_limit?.requests_per_minute) {
        const delay = (60 / this.config.performance.rate_limit.requests_per_minute) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    this.logger.info('Bulk ServiceNow sync completed', results);
    return results;
  }

  /**
   * Health check for reverse sync handler
   */
  async healthCheck() {
    const health = {
      status: 'healthy',
      processing_count: this.processingUpdates.size,
      features: {
        sync_status: this.config.features?.sync_status || false,
        sync_severity: this.config.features?.sync_severity || false
      }
    };

    return health;
  }

  /**
   * Clear processing locks (for testing/debugging)
   */
  clearProcessingLocks() {
    this.processingUpdates.clear();
    this.logger.info('Reverse sync processing locks cleared');
  }
}

module.exports = ReverseSyncHandler;