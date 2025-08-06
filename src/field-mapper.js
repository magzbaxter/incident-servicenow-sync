const vm = require('vm');

class FieldMapper {
  constructor(mappingsConfig, logger) {
    this.mappingsConfig = mappingsConfig;
    this.logger = logger;
    this.expressionCache = new Map();
  }

  /**
   * Map incident.io data to ServiceNow fields for incident creation
   */
  async mapForCreation(incidentData, serviceNowClient) {
    this.logger.debug('Mapping fields for incident creation', { 
      incident_id: incidentData.incident?.id 
    });
    
    const mappings = this.mappingsConfig.incident_creation;
    if (!mappings) {
      this.logger.warn('No creation mappings configured');
      return {};
    }

    return await this.applyMappings(mappings, incidentData, serviceNowClient);
  }

  /**
   * Map incident.io data to ServiceNow fields for incident updates
   */
  async mapForUpdate(incidentData, serviceNowClient, existingRecord = null) {
    this.logger.debug('Mapping fields for incident update', { 
      incident_id: incidentData.incident?.id,
      data_structure: incidentData.incident ? 'API format' : 'webhook format',
      severity_name: incidentData.incident?.severity?.name || incidentData.severity?.name
    });
    
    const mappings = this.mappingsConfig.incident_updates;
    if (!mappings) {
      this.logger.warn('No update mappings configured');
      return {};
    }

    return await this.applyMappings(mappings, incidentData, serviceNowClient, existingRecord);
  }

  /**
   * Apply field mappings to convert incident.io data to ServiceNow format
   */
  async applyMappings(mappings, incidentData, serviceNowClient, existingRecord = null) {
    const result = {};
    const errors = [];

    for (const [fieldName, mapping] of Object.entries(mappings)) {
      try {
        // Skip if condition is not met
        if (mapping.condition && !this.evaluateCondition(mapping.condition, incidentData)) {
          this.logger.debug(`Skipping field ${fieldName} - condition not met`, {
            condition: mapping.condition
          });
          continue;
        }

        // Get source value
        const sourceValue = this.getSourceValue(mapping.source, incidentData);
        
        // For work_notes field, allow empty strings to be processed
        const isWorkNotes = fieldName === 'work_notes';
        const shouldSkipField = isWorkNotes 
          ? (sourceValue === null || sourceValue === undefined)
          : (sourceValue === null || sourceValue === undefined || sourceValue === '');
          
        if (shouldSkipField) {
          if (mapping.required) {
            errors.push(`Required field ${fieldName} has no source value`);
            continue;
          }
          if (mapping.fallback !== undefined) {
            result[fieldName] = mapping.fallback;
            continue;
          }
          continue;
        }

        // Apply mapping based on type
        const mappedValue = await this.applyFieldMapping(
          fieldName, 
          mapping, 
          sourceValue, 
          serviceNowClient, 
          incidentData,
          existingRecord
        );

        if (mappedValue !== null && mappedValue !== undefined) {
          // Validate field length if specified
          if (mapping.max_length && typeof mappedValue === 'string' && mappedValue.length > mapping.max_length) {
            this.logger.warn(`Field ${fieldName} truncated from ${mappedValue.length} to ${mapping.max_length} characters`);
            result[fieldName] = mappedValue.substring(0, mapping.max_length);
          } else {
            result[fieldName] = mappedValue;
          }
        } else if (mapping.fallback !== undefined) {
          result[fieldName] = mapping.fallback;
        }

      } catch (error) {
        this.logger.error(`Failed to map field ${fieldName}`, {
          error: error.message,
          mapping: mapping
        });
        errors.push(`Field ${fieldName}: ${error.message}`);
        
        if (mapping.fallback !== undefined) {
          result[fieldName] = mapping.fallback;
        }
      }
    }

    // Apply custom mappings (calculated fields)
    if (this.mappingsConfig.custom_mappings) {
      await this.applyCustomMappings(this.mappingsConfig.custom_mappings, result, incidentData);
    }

    // Validate required fields
    this.validateRequiredFields(result, errors);

    if (errors.length > 0) {
      this.logger.warn('Field mapping completed with errors', { errors });
    }

    this.logger.debug('Field mapping completed', { 
      mapped_fields: Object.keys(result),
      errors: errors.length 
    });

    return result;
  }

  /**
   * Apply individual field mapping based on type
   */
  async applyFieldMapping(fieldName, mapping, sourceValue, serviceNowClient, incidentData, existingRecord) {
    switch (mapping.type) {
      case 'text':
        return this.mapTextField(sourceValue, mapping);

      case 'user_lookup':
        return await this.mapUserLookup(sourceValue, mapping, serviceNowClient);

      case 'reference_lookup':
        return await this.mapReferenceLookup(sourceValue, mapping, serviceNowClient);

      case 'choice_mapping':
        return this.mapChoiceField(sourceValue, mapping);

      case 'expression':
        return this.mapExpressionField(sourceValue, mapping, incidentData);

      case 'conditional':
        return this.mapConditionalField(sourceValue, mapping, incidentData);

      default:
        throw new Error(`Unknown mapping type: ${mapping.type}`);
    }
  }

  /**
   * Map text field with optional transformations
   */
  mapTextField(value, mapping) {
    // Handle empty strings for work_notes - convert to null to skip update
    if (value === '' && mapping.skip_empty_strings !== false) {
      return null;
    }
    
    if (typeof value !== 'string') {
      value = String(value);
    }

    // Apply transformations
    if (mapping.transform) {
      switch (mapping.transform.toLowerCase()) {
        case 'uppercase':
          value = value.toUpperCase();
          break;
        case 'lowercase':
          value = value.toLowerCase();
          break;
        case 'title':
          value = value.replace(/\w\S*/g, (txt) => 
            txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
          );
          break;
      }
    }

    return value;
  }

  /**
   * Map user lookup field
   */
  async mapUserLookup(value, mapping, serviceNowClient) {
    if (!value) return null;

    const lookupField = mapping.lookup_field || 'name';
    this.logger.debug('Performing user lookup', { value, lookup_field: lookupField });

    return await serviceNowClient.lookupUser(value, lookupField);
  }

  /**
   * Map reference lookup field
   */
  async mapReferenceLookup(value, mapping, serviceNowClient) {
    if (!value) return null;

    const table = mapping.lookup_table;
    const lookupField = mapping.lookup_field || 'name';
    
    if (!table) {
      throw new Error('lookup_table is required for reference_lookup type');
    }

    this.logger.debug('Performing reference lookup', { 
      value, 
      table, 
      lookup_field: lookupField 
    });

    return await serviceNowClient.lookupReference(table, value, lookupField);
  }

  /**
   * Map choice field using predefined mappings
   */
  mapChoiceField(value, mapping) {
    if (!value) return mapping.fallback || null;

    const mappings = mapping.mappings || {};
    const lowerValue = mappings[value.toLowerCase()];
    const exactValue = mappings[value];
    const mappedValue = lowerValue || exactValue || mapping.fallback;

    this.logger.info('Choice field mapping details', {
      input_value: value,
      lowercase_lookup: value.toLowerCase(),
      exact_lookup: value,
      lowercase_result: lowerValue,
      exact_result: exactValue,
      final_mapped_value: mappedValue,
      fallback: mapping.fallback,
      available_mappings: Object.keys(mappings)
    });

    if (!mappedValue && mapping.strict !== false) {
      this.logger.warn('No mapping found for choice value', { 
        value, 
        available_mappings: Object.keys(mappings) 
      });
    }

    return mappedValue || null;
  }

  /**
   * Map field using JavaScript expression
   */
  mapExpressionField(value, mapping, incidentData) {
    if (!mapping.expression) {
      throw new Error('expression is required for expression type');
    }

    try {
      // Create context for expression evaluation
      const context = {
        value,
        incident: incidentData.incident || {},
        data: incidentData,
        // Helper functions
        Math,
        String,
        Number,
        Date,
        JSON
      };

      // Use cached compiled expression if available
      const cacheKey = mapping.expression;
      let compiledExpression = this.expressionCache.get(cacheKey);
      
      if (!compiledExpression) {
        compiledExpression = new vm.Script(`(${mapping.expression})`);
        this.expressionCache.set(cacheKey, compiledExpression);
      }

      const result = compiledExpression.runInNewContext(context, { timeout: 1000 });
      
      this.logger.debug('Expression evaluated', { 
        expression: mapping.expression,
        input_value: value,
        result 
      });

      return result;
    } catch (error) {
      this.logger.error('Expression evaluation failed', {
        expression: mapping.expression,
        error: error.message
      });
      throw new Error(`Expression evaluation failed: ${error.message}`);
    }
  }

  /**
   * Map conditional field based on conditions
   */
  mapConditionalField(value, mapping, incidentData) {
    if (!mapping.conditions) {
      throw new Error('conditions array is required for conditional type');
    }

    for (const condition of mapping.conditions) {
      if (this.evaluateCondition(condition.if, incidentData)) {
        return condition.then;
      }
    }

    return mapping.else || mapping.fallback || null;
  }

  /**
   * Get value from source path (e.g., "incident.name")
   */
  getSourceValue(sourcePath, data) {
    if (!sourcePath) return null;

    try {
      const keys = sourcePath.split('.');
      let value = data;

      for (const key of keys) {
        // Handle array access like "services[0]"
        const arrayMatch = key.match(/^(.+)\[(\d+)\]$/);
        if (arrayMatch) {
          const [, arrayKey, index] = arrayMatch;
          value = value?.[arrayKey]?.[parseInt(index)];
        } else {
          value = value?.[key];
        }

        if (value === null || value === undefined) {
          return null;
        }
      }

      return value;
    } catch (error) {
      this.logger.warn('Failed to get source value', {
        source_path: sourcePath,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Evaluate condition expression
   */
  evaluateCondition(condition, data) {
    if (!condition) return true;

    try {
      const context = {
        incident: data.incident || {},
        data: data,
        // Helper functions
        Math,
        String,
        Number,
        Date
      };

      const result = vm.runInNewContext(condition, context, { timeout: 1000 });
      return Boolean(result);
    } catch (error) {
      this.logger.warn('Condition evaluation failed', {
        condition,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Apply custom mappings (calculated fields)
   */
  async applyCustomMappings(customMappings, result, incidentData) {
    for (const [fieldName, mapping] of Object.entries(customMappings)) {
      try {
        // Check dependencies
        if (mapping.depends_on) {
          const missingDeps = mapping.depends_on.filter(dep => result[dep] === undefined);
          if (missingDeps.length > 0) {
            this.logger.debug(`Skipping custom mapping ${fieldName} - missing dependencies`, {
              missing: missingDeps
            });
            continue;
          }
        }

        // Create context with result fields
        const context = {
          ...result,
          incident: incidentData.incident || {},
          data: incidentData,
          Math,
          String,
          Number,
          Date
        };

        const value = vm.runInNewContext(mapping.expression, context, { timeout: 1000 });
        if (value !== null && value !== undefined) {
          result[fieldName] = value;
        }

      } catch (error) {
        this.logger.error(`Failed to apply custom mapping ${fieldName}`, {
          error: error.message,
          expression: mapping.expression
        });
      }
    }
  }

  /**
   * Validate required fields
   */
  validateRequiredFields(result, errors) {
    const validationRules = this.mappingsConfig.validation_rules;
    if (!validationRules) return;

    // Check required fields for creation
    if (validationRules.required_fields_creation) {
      for (const field of validationRules.required_fields_creation) {
        if (result[field] === null || result[field] === undefined || result[field] === '') {
          errors.push(`Required field ${field} is missing or empty`);
        }
      }
    }

    // Check field length limits
    if (validationRules.max_field_lengths) {
      for (const [field, maxLength] of Object.entries(validationRules.max_field_lengths)) {
        if (result[field] && typeof result[field] === 'string' && result[field].length > maxLength) {
          this.logger.warn(`Field ${field} exceeds maximum length`, {
            current_length: result[field].length,
            max_length: maxLength
          });
        }
      }
    }
  }

  /**
   * Get mapping configuration for debugging
   */
  getMappingConfig() {
    return {
      creation_fields: Object.keys(this.mappingsConfig.incident_creation || {}),
      update_fields: Object.keys(this.mappingsConfig.incident_updates || {}),
      custom_fields: Object.keys(this.mappingsConfig.custom_mappings || {}),
      validation_rules: this.mappingsConfig.validation_rules || {}
    };
  }

  /**
   * Validate mapping configuration
   */
  validateConfiguration() {
    const errors = [];

    // Validate creation mappings
    if (this.mappingsConfig.incident_creation) {
      for (const [field, mapping] of Object.entries(this.mappingsConfig.incident_creation)) {
        this.validateFieldMapping(field, mapping, errors);
      }
    }

    // Validate update mappings
    if (this.mappingsConfig.incident_updates) {
      for (const [field, mapping] of Object.entries(this.mappingsConfig.incident_updates)) {
        this.validateFieldMapping(field, mapping, errors);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate individual field mapping
   */
  validateFieldMapping(fieldName, mapping, errors) {
    if (!mapping.type) {
      errors.push(`Field ${fieldName}: type is required`);
      return;
    }

    if (!mapping.source && mapping.type !== 'expression') {
      errors.push(`Field ${fieldName}: source is required for type ${mapping.type}`);
    }

    switch (mapping.type) {
      case 'reference_lookup':
        if (!mapping.lookup_table) {
          errors.push(`Field ${fieldName}: lookup_table is required for reference_lookup`);
        }
        break;
      case 'choice_mapping':
        if (!mapping.mappings) {
          errors.push(`Field ${fieldName}: mappings object is required for choice_mapping`);
        }
        break;
      case 'expression':
        if (!mapping.expression) {
          errors.push(`Field ${fieldName}: expression is required for expression type`);
        }
        break;
    }
  }
}

module.exports = FieldMapper;