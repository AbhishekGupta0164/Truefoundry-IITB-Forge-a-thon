# S3 Spike Report: Approval Pause and Cancellation

## 1. Summary of Observed Behavior

- **Pause Granularity**: Tool calls pause sequentially per execution turn when approvals are awaited
- **Resume Method**: `client.sessions.createTurnStream(sessionId, { input: [userToolApprovalEvent] })`
- **Call ID Association**: Matched by exact toolCallId in UserToolApprovalInputEvent
- **Model Visibility of Denial**: Model receives `tool_result` with status `denied` and the provided rejection reason.

---

## 2. Exact Approval-Required Event Structure

When TrueForge reaches a tool marked with `requireApprovalForTools: ["apply_patch_hunk"]`, it pauses the turn stream and emits:

```json
{
  "type": "tool.approval_required",
  "createdAt": "2026-11-16T15:54:56.772Z",
  "threadId": "thread-main",
  "toolCalls": [
    {
      "id": "call-h1-001",
      "sourceEventId": "event-model-001"
    }
  ]
}
```

Key fields:
- `type`: `"tool.approval_required"` (Literal SDK event discriminator)
- `toolCalls`: Array of `ToolCallRef` (`{ id: string, sourceEventId: string }`)
- `threadId`: Active thread identifier
- `createdAt`: Timestamp of pause

---

## 3. Exact Resume Method and Payload Shape

Resuming an agent turn requires submitting a turn stream request with input items of type `user.tool_approval`.

**SDK Call:**
```typescript
await client.sessions.createTurnStream(sessionId, {
  input: [
    {
      type: "user.tool_approval",
      toolCallId: "call_abc123",
      approval: {
        status: "allow" // or { status: "deny", reason: "User rejected hunk" }
      }
    }
  ]
});
```

**Payload Shape:**
```json
{
  "type": "user.tool_approval",
  "toolCallId": "call-h1-001",
  "approval": {
    "status": "allow"
  }
}
```

> **Invariant**: Never mix `user.message` and `user.tool_approval` in the same `input` array. The SDK throws an error if user messages and tool approval responses are co-mingled.

---

## 4. Individual Call ID Association

- Approval decisions are keyed strictly by `toolCallId`.
- The extension does NOT assume array ordering; each decision explicitly targets a single `toolCallId`.
- Unknown or mismatched IDs are rejected before transmission.

---

## 5. Cancellation Behavior (`client.sessions.cancel`)

- **Method**: `await client.sessions.cancel(sessionId)`
- **Pending Approvals**: Pending tool approval requests are immediately aborted.
- **Turn State**: The current turn transitions to status `"cancelled"`.
- **Session Reusability**: The session remains usable; subsequent turns can be created on the same session root.
- **Final Event**: The turn stream emits `turn.done` with status `"cancelled"`.

---

## 6. Verification Status

- [x] Spike MCP server stub: `apply_patch_hunk`
- [x] S3 approval pause event observed
- [x] Allow for h1 written to disk fixture
- [x] Deny for h2 prevented disk write
- [x] `sessions.cancel()` verified
