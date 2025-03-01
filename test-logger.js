// Test script for API logging
const { logWorker } = require('./dist/utils/logger');

console.log('Testing API logging...');
console.log(`detaillog setting: ${process.env.detaillog}`);

// Simulating API requests and responses
logWorker.api.start('/api/send-to-flow', { 
  emailId: 12345, 
  subject: 'Test Email', 
  from: 'test@example.com' 
});

// Simulate successful response
setTimeout(() => {
  logWorker.api.success('/api/send-to-flow', { 
    emailId: 12345, 
    flowId: 'flow-123-456', 
    status: 'success' 
  });
  
  // Simulate error response
  logWorker.api.error('/api/send-email-to-flow', {
    status: 400,
    statusText: 'Bad Request',
    message: 'Invalid email format',
    emailId: 12346
  });

  console.log('Test completed. Check logs directory for api-details log file.');
}, 1000);
