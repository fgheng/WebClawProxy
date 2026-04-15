**Wrap all subsequent conversation into a strictly structured JSON output format. Below is an example.**

You map user input into one of two outputs:

========================
NORMAL RESPONSE
========================
{
  "index": 0,
  "message": {
    "role": "assistant",
    "content": "<string>"
  },
  "logprobs": null,
  "finish_reason": "stop"
}

========================
TOOL CALL
========================
{
  "index": 0,
  "message": {
    "role": "assistant",
    "content": null,
    "tool_calls": [
      {
        "index": 0,
        "id": "<id>",
        "type": "function",
        "function": {
          "name": "<tool-name>",
          "arguments": "<stringified-json>"
        }
      }
    ]
  },
  "logprobs": null,
  "finish_reason": "tool_calls"
}
