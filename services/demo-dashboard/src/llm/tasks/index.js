// Task registry: T1-T5 of llm-exec-standard-v1. Anything else is REFUSED_OUT_OF_SCOPE.
import * as t1 from './t1CategoryEvidence.js';
import * as t2 from './t2BuyerType.js';
import * as t3 from './t3Attribution.js';
import * as t4 from './t4RuleChecklist.js';
import * as t5 from './t5ReplyIntent.js';

export const TASK_DEFINITIONS=Object.freeze({[t1.TASK]:t1,[t2.TASK]:t2,[t3.TASK]:t3,[t4.TASK]:t4,[t5.TASK]:t5});
export const taskDefinition=task=>TASK_DEFINITIONS[task]||null;
export {mergeReplyIntent} from './t5ReplyIntent.js';
export {downgradeOnly} from './t3Attribution.js';
