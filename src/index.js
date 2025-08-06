#!/usr/bin/env node

/**
 * Incident.io to ServiceNow Integration
 * 
 * A comprehensive, production-ready integration that syncs incidents
 * between incident.io and ServiceNow with flexible field mapping,
 * ServiceNow ID lookup, and advanced features.
 */

require('dotenv').config();

const path = require('path');
const App = require('./app');

// Handle uncaught exceptions gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

/**
 * Main entry point
 */
async function main() {
  try {
    console.log('🚀 Starting incident.io → ServiceNow Integration...');
    console.log(`📁 Working directory: ${process.cwd()}`);
    console.log(`📦 Version: ${process.env.npm_package_version || '2.0.0'}`);
    console.log(`🔧 Node.js: ${process.version}`);
    
    // Create and start the application
    const app = new App();
    const server = await app.start();

    console.log('✅ Integration started successfully!');
    console.log('📊 Health check: GET /health');
    console.log('🔗 Webhook endpoint: POST /webhook');
    console.log('🔧 Manual sync: POST /sync/incident/:incidentId');

    // Display configuration summary (without sensitive data)
    if (app.config) {
      console.log('\n📋 Configuration Summary:');
      console.log(`   ServiceNow: ${app.config.servicenow?.instance_url}`);
      console.log(`   incident.io: ${app.config.incident_io?.api_url}`);
      console.log(`   Webhook port: ${process.env.PORT || app.config.webhook?.port || 'NOT CONFIGURED'}`);
      console.log(`   Features: ${JSON.stringify(app.config.features)}`);
    }

    // Graceful shutdown handling
    const shutdown = async (signal) => {
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      
      if (server) {
        server.close(() => {
          console.log('✅ HTTP server closed');
          process.exit(0);
        });
        
        // Force close after 10 seconds
        setTimeout(() => {
          console.log('⚠️  Forcing shutdown after timeout');
          process.exit(1);
        }, 10000);
      } else {
        process.exit(0);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start integration:', error.message);
    
    // Display helpful error messages for common issues
    if (error.message.includes('No configuration file found')) {
      console.error('\n💡 Quick fix:');
      console.error('   cp config/config.example.json config/config.json');
      console.error('   cp config/field-mappings.example.json config/field-mappings.json');
      console.error('   # Then edit config/config.json with your settings');
    }
    
    if (error.message.includes('environment variable') && error.message.includes('not set')) {
      console.error('\n💡 Required environment variables:');
      console.error('   INCIDENT_IO_API_KEY=your_api_key');
      console.error('   SERVICENOW_USERNAME=your_username');
      console.error('   SERVICENOW_PASSWORD=your_password');
      console.error('   WEBHOOK_SECRET=your_webhook_secret');
      console.error('\n   You can set these in a .env file or as environment variables');
    }

    console.error('\n📚 For more help, see the README.md or docs/');
    process.exit(1);
  }
}

// CLI argument handling
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Incident.io to ServiceNow Integration

Usage: node src/index.js [options]

Options:
  --help, -h          Show this help message
  --version, -v       Show version information
  --validate-config   Validate configuration files
  --health-check      Run health check and exit

Environment Variables:
  INCIDENT_IO_API_KEY     incident.io API key (required)
  SERVICENOW_INSTANCE_URL ServiceNow instance URL (required)
  SERVICENOW_USERNAME     ServiceNow username (required)
  SERVICENOW_PASSWORD     ServiceNow password (required)
  PORT                    HTTP server port (required)
  WEBHOOK_SECRET          incident.io webhook secret (optional)
  WEBHOOK_VERIFY_SIGNATURE Enable incident.io webhook verification (optional)
  SERVICENOW_WEBHOOK_SECRET ServiceNow webhook secret (optional)
  SERVICENOW_WEBHOOK_VERIFY_SIGNATURE ServiceNow webhook verification (optional)
  LOG_LEVEL              Logging level (optional, default: info)

Configuration Files:
  config/config.json          Main configuration
  config/field-mappings.json  Field mapping configuration

Examples:
  node src/index.js                    # Start the integration
  node src/index.js --validate-config  # Validate configuration
  node src/index.js --health-check     # Run health check

For more information, visit: https://github.com/your-org/incident-servicenow-sync
`);
    process.exit(0);
  }
  
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`incident-servicenow-sync v${process.env.npm_package_version || '2.0.0'}`);
    process.exit(0);
  }
  
  if (args.includes('--validate-config')) {
    const ConfigManager = require('./config-manager');
    const config = new ConfigManager();
    
    console.log('🔍 Validating configuration...');
    
    config.load()
      .then(() => {
        console.log('✅ Configuration is valid');
        console.log('📋 Configuration summary:');
        console.log(JSON.stringify(config.getConfigSummary(), null, 2));
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Configuration validation failed:', error.message);
        process.exit(1);
      });
    return;
  }
  
  if (args.includes('--health-check')) {
    console.log('🏥 Running health check...');
    
    const App = require('./app');
    const app = new App();
    
    app.initialize()
      .then(() => app.incidentHandler.healthCheck())
      .then((health) => {
        console.log('📊 Health check results:');
        console.log(JSON.stringify(health, null, 2));
        
        if (health.status === 'healthy') {
          console.log('✅ All systems healthy');
          process.exit(0);
        } else {
          console.log('⚠️  Some systems unhealthy');
          process.exit(1);
        }
      })
      .catch((error) => {
        console.error('❌ Health check failed:', error.message);
        process.exit(1);
      });
    return;
  }
  
  // Default: start the main application
  main();
}