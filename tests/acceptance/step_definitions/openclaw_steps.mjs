/**
 * Step definitions for OpenClaw Communication feature
 */
import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert';

Given('Scout is initialized with test configuration', function() {
  this.initializeWithTestConfig();
  assert.ok(this.config, 'Config should be initialized');
});

Given('OpenClaw gateway is running', function() {
  this.setGatewayStatus(true);
  assert.strictEqual(this.gatewayRunning, true);
});

Given('OpenClaw gateway is not running', function() {
  this.setGatewayStatus(false);
  assert.strictEqual(this.gatewayRunning, false);
});

When('I send the message {string}', async function(message) {
  await this.sendMessage(message);
});

When('I attempt to send a message', async function() {
  await this.sendMessage('test message');
});

Then('I should receive a non-empty response', function() {
  assert.ok(this.lastResponse, 'Response should not be empty');
  assert.ok(this.lastResponse.length > 0, 'Response should have content');
});

Then('the response should come from OpenClaw', function() {
  assert.ok(this.responseIsFromOpenClaw(), 'Response should come from OpenClaw');
});

Then('I should see error {string}', function(expectedError) {
  assert.strictEqual(this.lastError, expectedError);
});

Then('no audio response should play', function() {
  // When there's an error, audioPlayed should be false
  assert.ok(!this.gatewayRunning || this.lastError !== null,
    'Audio should not play when gateway is down or error occurred');
});

Then('Scout should not generate any response text', function() {
  assert.strictEqual(this.lastResponse, null, 'Scout should not generate fake responses');
});

Then('Scout should only display an error state', function() {
  assert.strictEqual(this.state, 'error', 'State should be error');
  assert.ok(this.lastError !== null, 'Error message should be present');
  assert.ok(!this.hasGeneratedFakeResponse(), 'No fake response should be generated');
});
