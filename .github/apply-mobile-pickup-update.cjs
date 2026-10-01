const fs = require('node:fs');

const path = 'apps/mobile/olli-talk-beta.js';
let text = fs.readFileSync(path, 'utf8');

const resolverAnchor = "  async function resolveOlliTalkPickupAddAgentTurn(commandText,context,replyToMessageId){";
const resolver = [
"  async function resolveOlliTalkPickupUpdateAgentTurn(commandText,context,replyToMessageId){",
"    const sourceMessageId=Number(replyToMessageId || 0);",
"    if(!Number.isSafeInteger(sourceMessageId) || sourceMessageId<=0){",
"      throw new Error('픽업 수정 요청의 원문 메시지를 확인하지 못했습니다.');",
"    }",
"",
"    const response=await fetch('/api/olli-agent',{",
"      method:'POST',",
"      headers:{'Content-Type':'application/json'},",
"      body:JSON.stringify({",
"        mode:'pickup_update_prepare',",
"        academyId:context?.academyId || '',",
"        sessionToken:context?.sessionToken || '',",
"        message:String(commandText || '').trim(),",
"        sourceMessageId",
"      })",
"    });",
"    const data=await response.json().catch(()=>({}));",
"    if(!response.ok || data?.ok!==true || !data?.message?.action){",
"      throw new Error(data?.error || data?.message || '픽업 수정 Agent 응답을 받지 못했습니다.');",
"    }",
"",
"    const actionType=String(data.message.action.action_type || '').trim();",
"    if(!['update_pickup_arrival','update_pickup_dropoff'].includes(actionType)){",
"      throw new Error('픽업 수정 Agent 작업 종류가 올바르지 않습니다.');",
"    }",
"",
"    return{",
"      assistantMessage:data.message,",
"      replyText:String(data.message.body || '').trim(),",
"      recordAi:false",
"    };",
"  }",
"",
""
].join('\n');

if (!text.includes(resolverAnchor)) throw new Error('mobile resolver anchor missing');
if (!text.includes('resolveOlliTalkPickupUpdateAgentTurn(')) {
  text = text.replace(resolverAnchor, resolver + resolverAnchor);
}

const addGate = [
"    if(isOlliTalkPickupAddAgentCandidate(commandText,router)){",
"      return resolveOlliTalkPickupAddAgentTurn(commandText,context,replyToMessageId);",
"    }"
].join('\n');

const updateGate = [
"    if(isOlliTalkPickupUpdateAgentCandidate(commandText,router)){",
"      return resolveOlliTalkPickupUpdateAgentTurn(commandText,context,replyToMessageId);",
"    }",
"",
addGate
].join('\n');

if (!text.includes(addGate)) throw new Error('mobile add gate missing');
if (!text.includes('if(isOlliTalkPickupUpdateAgentCandidate(commandText,router)){')) {
  text = text.replace(addGate, updateGate);
}

fs.writeFileSync(path, text);
