/** Tool effects are server-owned metadata, never a model permission grant. */
export const toolPolicy={
 read_owned_software:{effect:'read_only',scope:'current_owned_synthetic_software_with_live_grant',result:'current_software_simulator_readback_not_hardware',revocation:'recheck_before_final_answer'},
 explore_owned_software:{effect:'local_write',scope:'current_owned_synthetic_software_lab_only',result:'static_adapter_candidate_and_read_probe_not_control',idempotency:'fixed_target_artifact_digest'},
 complete_answer:{effect:'local_write',scope:'live_item_grants_and_final_response_contract',result:'final_candidate_and_public_original_quote_locators_no_business_write',idempotency:'original_document_and_quote_digest'},
 get_item_context:{effect:'read_only',scope:'live_item_grant',result:'reality_cards'},
 search_product_knowledge:{effect:'local_write',scope:'live_item_grant_public_sources_only',result:'sourced_knowledge_cache',idempotency:'document_digest'},
 inspect_manual_visual:{effect:'read_only',scope:'live_item_grant_public_official_document',result:'provider_observation'},
 read_official_page:{effect:'read_only',scope:'live_item_grant_public_official_document',result:'provider_observation'},
 get_relevant_experiences:{effect:'read_only',scope:'live_item_grant_and_purpose_cloud_consent',result:'approved_user_reports'},
 check_constraints:{effect:'read_only',scope:'bound_or_explicit_hypothetical_operands',result:'necessary_conditions_not_physical_verification'},
 open_item_capability:{effect:'read_only',scope:'live_item_grant',result:'same_item_continuation'},
 prepare_action:{effect:'propose',scope:'live_item_grants',result:'pending_confirmation_card',idempotency:'domain_confirmation_request_id',confirmation:'explicit_user_action_required'},
} as const;
