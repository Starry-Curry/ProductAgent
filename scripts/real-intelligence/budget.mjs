export const ROUND_ID='real-intelligence-20261031-r1';
export function assertBudget(ledger,reservation){
 if(ledger.task!==ROUND_ID||!Array.isArray(ledger.attempts))throw Error('round_identity_mismatch');
 if(!Number.isFinite(reservation)||reservation<=0)throw Error('invalid_reservation');
 const spend=ledger.attempts.reduce((n,a)=>n+(a.estimatedCny??a.reservedCny),0);
 if(!Number.isFinite(spend)||ledger.attempts.some(a=>!(Number.isFinite(a.estimatedCny??a.reservedCny))||(a.estimatedCny??a.reservedCny)<0))throw Error('invalid_historical_charge');
 if(ledger.attempts.length>=150||spend+reservation>50)throw Error('stage_budget_exhausted');
 return spend;
}
