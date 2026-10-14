Feature: Ask what already occupies a repository before editing it

  Before an agent edits a repository, it asks spacequery for the `here`
  report: who else works there, the state of the checkout, and what runs
  inside it. A provider that is missing on the machine must not fail the
  call; the report names it, so the agent knows which empty section it
  cannot trust.

  Scenario: the report counts the uncommitted change and names each provider that did not answer
    Given a git repository with a committed file changed and not committed
    When the agent asks spacequery for the report on that repository
    Then the checkout section counts one uncommitted change
    And each section whose provider did not answer carries that provider's error
    When the agent gates on other agents in the repository
    Then the gate passes, and the strict gate fails only when a provider did not answer
