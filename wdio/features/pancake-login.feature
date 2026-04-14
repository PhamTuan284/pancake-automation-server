Feature: Pancake POS e-invoice automation

  As an operator
  I want the same flow as POST /run-einvoice-automation
  So that E2E exercises the real login + invoice table automation

  Credentials and Mongo rows come from pancake-automation-server/.env
  (PANCAKE_LOGIN_PHONE + PANCAKE_LOGIN_PASSWORD, MONGODB_URI / MONGO_URL).

  @smoke @pancake
  Scenario: Run e-invoice automation in browser
    When I run the Pancake e-invoice automation
    Then I should be on the e-invoices page
