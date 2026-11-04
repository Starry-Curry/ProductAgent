/** Stable team entry point. These are the actual product services, not a second
 * runtime, database, permission layer or schema. Call only after authentication. */
export const FOUNDATION_API_VERSION='foundation-services/1' as const;
export type {State,Person,Item} from '../domain.ts';
export {readReality} from '../context/reality-service.ts';
export {registeredCapabilities} from './capabilities.ts';
export {discoverCapabilities,type CapabilityDiscovery} from '../context/discovery.ts';
export {compileTaskContext} from '../context/compiler.ts';
export type {RealityCard,RealityFact,RealityCapability} from '../context/reality.ts';
export {ProviderError} from '../ai/provider.ts';
export type {Provider,ModelMessage,ModelResponse,ToolDefinition} from '../ai/provider.ts';
export {AgentError,turnInputSchema} from '../agent/contracts.ts';
export type {TurnRequest,TurnInput,TurnResult,ServiceSession} from '../agent/contracts.ts';
export {respond} from '../agent/service.ts';
export {createTask,getTask,recordOutcome,resolveTaskContext,amendOutcome} from './tasks.ts';
export type {TaskSpec,TaskRun,CreateTaskInput,OutcomeInput,AmendOutcomeInput} from './tasks.ts';
export {readKnowledge} from '../life/acquisition.ts';
export type {AcquiredDocument,KnowledgeChunk} from '../life/acquisition.ts';
export type {KnowledgeReference,PublicSourceAssertion} from '../context/source-reference.ts';
export type {SourceReading,PublicVisualReading} from '../life/sources.ts';
export type SharedTaskContext=ReturnType<typeof import('../context/compiler.ts').compileTaskContext>;
