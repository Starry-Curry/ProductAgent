/** Browser responses may be JSON or SSE; transport success is not task success. */
export async function assistantResponse(response){
 const headers=typeof response.headers==='function'?response.headers():Object.fromEntries(response.headers.entries());
 if(!headers['content-type']?.includes('text/event-stream'))return response.json();
 const body=(await response.text()).replaceAll('\r\n','\n');let result;
 for(const frame of body.split('\n\n')){
  const event=frame.match(/^event:\s*(.+)$/m)?.[1];
  const raw=frame.match(/^data:\s*(.+)$/m)?.[1];
  if(!raw)continue;const data=JSON.parse(raw);
  if(event==='failure')throw Error(data.error||'assistant_stream_failure');
  if(event==='result')result=data;
 }
 if(!result?.reply||!result?.session)throw Error('assistant_stream_no_final_result');
 return result;
}
