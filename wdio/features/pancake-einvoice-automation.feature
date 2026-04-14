Feature: E-invoice automation (Mongo → login → fill table)

  Full flow in explicit steps (same operations as the former POST /run-einvoice-automation).
  Requires MongoDB and the same credentials as other WDIO features.

  Scenario: Load invoice rows, sign in, process pending rows
    Given MongoDB is configured for invoice clients
    When I load invoice client rows from MongoDB
    And I sign in to Pancake and open the e-invoices page
    And I process pending e-invoice table rows using the loaded Mongo rows
    Then I should be on the Pancake e-invoices page
