/** Stable team entry point. These are the actual product services, not a second
 * runtime, database, permission layer or schema. Call only after authentication. */
export {readReality} from '../context/reality-service.ts';
export {discoverCapabilities,type CapabilityDiscovery} from '../context/discovery.ts';
export {compileTaskContext} from '../context/compiler.ts';
export type {RealityCard,RealityFact,RealityCapability} from '../context/reality.ts';
export type {Provider} from '../ai/provider.ts';
export {respond} from '../agent/service.ts';
export {createTask,getTask,recordOutcome,resolveTaskContext} from './tasks.ts';
export type {TaskSpec,TaskRun,CreateTaskInput,OutcomeInput} from './tasks.ts';
export {readKnowledge} from '../life/acquisition.ts';
export type {AcquiredDocument,KnowledgeChunk} from '../life/acquisition.ts';
export type {KnowledgeReference,PublicSourceAssertion} from '../context/source-reference.ts';
export type {SourceReading,PublicVisualReading} from '../life/sources.ts';
export type SharedTaskContext=ReturnType<typeof import('../context/compiler.ts').compileTaskContext>;
