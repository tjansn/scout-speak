Feature: OpenClaw Communication
  As a user
  I want Scout to send my transcribed speech to OpenClaw
  So that I get responses from my agent

  Background:
    Given Scout is initialized with test configuration

  Scenario: Successful agent response
    Given OpenClaw gateway is running
    When I send the message "Hello"
    Then I should receive a non-empty response
    And the response should come from OpenClaw

  Scenario: Gateway unreachable
    Given OpenClaw gateway is not running
    When I attempt to send a message
    Then I should see error "Cannot reach OpenClaw"
    And no audio response should play

  Scenario: Never fake responses
    Given OpenClaw gateway is not running
    When I attempt to send a message
    Then Scout should not generate any response text
    And Scout should only display an error state
