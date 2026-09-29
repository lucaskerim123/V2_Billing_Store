function scalar(value:unknown){
  if(typeof value==="string")return value.trim();
  if(typeof value==="number"||typeof value==="boolean")return String(value);
  return "";
}

export function errorMessage(value:unknown,fallback="Request failed"){
  const seen=new Set<unknown>();

  function read(input:unknown,depth=0):string{
    const direct=scalar(input);
    if(direct&&direct!=="[object Object]")return direct;
    if(!input||depth>6||typeof input!=="object")return "";

    if(seen.has(input))return "";
    seen.add(input);

    if(input instanceof Error){
      const fromMessage=read(input.message,depth+1);
      if(fromMessage)return fromMessage;
      const fromName=scalar(input.name);
      if(fromName&&fromName!=="Error")return fromName;
    }

    const record=input as Record<string,unknown>;
    for(const key of ["message","error_description","detail","error","reason","code"]){
      const nested=read(record[key],depth+1);
      if(nested)return nested;
    }

    try{
      const json=JSON.stringify(input);
      if(json&&json!=="{}"&&json!=="[]"&&json!=="\"[object Object]\"")return json;
    }catch{}

    return "";
  }

  return read(value)||fallback;
}
