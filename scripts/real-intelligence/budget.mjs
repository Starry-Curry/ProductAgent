export const ROUND_ID='real-intelligence-20261031-r1';
export function assertBudget(ledger,reservation,limits={roundId:ROUND_ID,requests:150,cny:50}){
 if(!limits.roundId||!Number.isInteger(limits.requests)||limits.requests<1||!Number.isFinite(limits.cny)||limits.cny<=0)throw Error('invalid_authorized_limits');
 if(ledger.task!==limits.roundId||!Array.isArray(ledger.attempts))throw Error('round_identity_mismatch');
 if(!Number.isFinite(reservation)||reservation<=0)throw Error('invalid_reservation');
 const spend=ledger.attempts.reduce((n,a)=>n+(a.estimatedCny??a.reservedCny),0);
 if(!Number.isFinite(spend)||ledger.attempts.some(a=>!(Number.isFinite(a.estimatedCny??a.reservedCny))||(a.estimatedCny??a.reservedCny)<0))throw Error('invalid_historical_charge');
 if(ledger.attempts.length>=limits.requests||spend+reservation>limits.cny)throw Error('stage_budget_exhausted');
 return spend;
}
