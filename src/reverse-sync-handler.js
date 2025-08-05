/**
 * Handles synchronization from ServiceNow to incident.io
 * This is triggered when ServiceNow incidents are updated
 */
class ReverseSyncHandler {
  constructor(serviceNowClient, incidentIOClient, config, logger) {
    this.serviceNowClient = serviceNowClient;
    this.incidentIOClient = incidentIOClient;
    this.config = config;
    this.logger = logger;
    
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
        updates.status = incidentIOStatus;
        this.logger.debug('Mapping incident_state to incident.io status', {
          servicenow_state: serviceNowIncident.incident_state,
          incident_io_status: incidentIOStatus
        });
      }
    }

    // Map priority/severity changes (if configured)
    if (this.config.features?.sync_severity && updatedFields.includes('priority')) {
      const incidentIOSeverity = this.mapServiceNowPriorityToIncidentIO(serviceNowIncident.priority);
      if (incidentIOSeverity) {
        updates.severity = incidentIOSeverity;
        this.logger.debug('Mapping priority to incident.io severity', {
          servicenow_priority: serviceNowIncident.priority,
          incident_io_severity: incidentIOSeverity
        });
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
      if (updates.status) updateOptions.status = updates.status;
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
   * Map ServiceNow incident state to incident.io status
   */
  mapServiceNowStatusToIncidentIO(serviceNowState) {
    // Default ServiceNow incident states mapping
    const statusMapping = {
      '1': 'open',      // New
      '2': 'open',      // In Progress  
      '3': 'open',      // On Hold
      '6': 'closed',    // Resolved
      '7': 'closed',    // Closed
      '8': 'closed'     // Canceled
    };

    // Allow custom mapping from config
    if (this.config.reverse_mappings?.status) {
      return this.config.reverse_mappings.status[serviceNowState] || statusMapping[serviceNowState];
    }

    return statusMapping[serviceNowState];
  }

  /**
   * Map ServiceNow priority to incident.io severity
   */
  mapServiceNowPriorityToIncidentIO(serviceNowPriority) {
    // Default ServiceNow priority to incident.io severity mapping
    const severityMapping = {
      '1': 'critical',   // Critical
      '2': 'major',      // High
      '3': 'minor',      // Moderate
      '4': 'minor',      // Low
      '5': 'minor'       // Planning
    };

    // Allow custom mapping from config
    if (this.config.reverse_mappings?.severity) {
      return this.config.reverse_mappings.severity[serviceNowPriority] || severityMapping[serviceNowPriority];
    }

    return severityMapping[serviceNowPriority];
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