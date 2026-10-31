// Minimal JSON Schema validator for the fixed task output schemas (subset: type incl. type arrays,
// enum, const, properties, required, additionalProperties:false, items, minItems/maxItems,
// minLength/maxLength, minimum/maximum, pattern). Evaluated in docs/REUSE_CANDIDATE_REGISTRY.md
// against Ajv: the schemas are ours and fixed, so a 60-line subset avoids a new dependency.
const typeOf=value=>value===null?'null':Array.isArray(value)?'array':Number.isInteger(value)?'integer':typeof value;
const matchesType=(value,type)=>{
  const actual=typeOf(value);
  return actual===type||(type==='number'&&actual==='integer');
};

/** Returns a list of error strings (empty = valid). */
export function validateSchema(schema,value,path='$'){
  const errors=[];
  if(!schema||typeof schema!=='object')return errors;
  if(schema.type){
    const types=Array.isArray(schema.type)?schema.type:[schema.type];
    if(!types.some(type=>matchesType(value,type))){errors.push(`${path}: expected ${types.join('|')}`);return errors;}
  }
  if('const' in schema&&value!==schema.const)errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if(schema.enum&&!schema.enum.includes(value))errors.push(`${path}: not an allowed value`);
  if(typeof value==='string'){
    if(schema.minLength!==undefined&&[...value].length<schema.minLength)errors.push(`${path}: too short`);
    if(schema.maxLength!==undefined&&[...value].length>schema.maxLength)errors.push(`${path}: too long`);
    if(schema.pattern&&!new RegExp(schema.pattern,'u').test(value))errors.push(`${path}: bad format`);
  }
  if(typeof value==='number'){
    if(schema.minimum!==undefined&&value<schema.minimum)errors.push(`${path}: below minimum`);
    if(schema.maximum!==undefined&&value>schema.maximum)errors.push(`${path}: above maximum`);
  }
  if(Array.isArray(value)){
    if(schema.minItems!==undefined&&value.length<schema.minItems)errors.push(`${path}: too few items`);
    if(schema.maxItems!==undefined&&value.length>schema.maxItems)errors.push(`${path}: too many items`);
    if(schema.items)value.forEach((item,index)=>errors.push(...validateSchema(schema.items,item,`${path}[${index}]`)));
  }
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    for(const key of schema.required||[])if(!(key in value))errors.push(`${path}.${key}: required`);
    const props=schema.properties||{};
    for(const [key,item] of Object.entries(value)){
      if(props[key])errors.push(...validateSchema(props[key],item,`${path}.${key}`));
      else if(schema.additionalProperties===false)errors.push(`${path}.${key}: not allowed`);
    }
  }
  return errors;
}

/**
 * Schema for provider structured-output features: the same shape without length, range and pattern
 * keywords some providers do not accept. The full schema is still checked on our side.
 */
export function providerSchema(schema){
  if(Array.isArray(schema))return schema.map(providerSchema);
  if(!schema||typeof schema!=='object')return schema;
  const out={};
  for(const [key,value] of Object.entries(schema)){
    if(['minLength','maxLength','minimum','maximum','pattern','minItems','maxItems','const'].includes(key))continue;
    out[key]=typeof value==='object'?providerSchema(value):value;
  }
  return out;
}
