Feature: Pancake POS e-invoice access

  As an operator
  I want to sign in to Pancake POS
  So that I can reach the e-invoices screen

  Credentials come from pancake-automation-server/.env
  (PANCAKE_LOGIN_PHONE + PANCAKE_LOGIN_PASSWORD, or PANCAKE_ACCOUNT + PANCAKE_PASSWORD).

  @smoke @pancake
  Scenario: Log in and open e-invoices
    When I complete the Pancake login flow to e-invoices
    Then I should be on the e-invoices page
