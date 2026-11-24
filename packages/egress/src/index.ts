export { EgressEngine, type EgressDecision, type EgressPolicy } from './engine.js';
export { resolveIP, lookupRegion, parseIPv6Bytes } from './resolver.js';
export { EgressGate, installEgressDispatcher, type EgressGateOptions } from './interceptor.js';
