/**
 * fou-policy: workspace ACL preamble for dispatch.
 * Must not call LLM or Hermes.
 */
export {
  buildPolicyPreamble,
  composeEmployeeTaskMessage,
} from "../utils/employees";
