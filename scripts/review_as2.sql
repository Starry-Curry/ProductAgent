-- Read-only audit. Open the ACTIVE profile's SQLite file, not an old preview DB.
PRAGMA query_only = ON;
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
SELECT id,username,display_name FROM users;
SELECT id,name,product_id,photo_id,version,state FROM items;
SELECT id,goal,status,version,
       json_extract(plan,'$.guidance.active_step_id') AS active_step,
       json_extract(plan,'$.guidance.lesson.phase') AS phase,
       json_extract(plan,'$.guidance.lesson.inputs') AS inputs
FROM tasks ORDER BY updated_at DESC;
SELECT t.id AS task_id,j.value->>'$.id' AS step_id,j.value->>'$.state' AS state,
       j.value->>'$.guidance.observed_quote' AS user_report
FROM tasks t,json_each(t.plan,'$.entries') j;
SELECT conversation_id,role,text,created_at FROM messages ORDER BY created_at;
SELECT id,status,error,usage,events FROM runs ORDER BY updated_at DESC;
SELECT id,origin,title,url,asset_id FROM sources;
SELECT id,owner_id,media_type,original_name,path FROM assets;
SELECT id,user_id,item_id,content,active FROM memories;
-- Plans and diagrams are JSON in tasks.plan; raw photo/video/PDF bytes are assets.path files.
-- For a running WAL database use sqlite3.Connection.backup(), not a copy of only the .sqlite3 file.
