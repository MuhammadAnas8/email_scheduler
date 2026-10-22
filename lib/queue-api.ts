import { NextResponse } from "next/server";

type QueueRpcError = { code?: string };

export function queueRpcErrorResponse(error: QueueRpcError) {
  switch (error.code) {
    case "42501":
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    case "P0002":
      return NextResponse.json({ error: "Batch or message not found." }, { status: 404 });
    case "22023":
      return NextResponse.json({ error: "The scheduling request is invalid." }, { status: 400 });
    case "55000":
      return NextResponse.json({ error: "This action is not available for the current status." }, { status: 409 });
    default:
      return NextResponse.json({ error: "The queue action could not be saved." }, { status: 500 });
  }
}

export function invalidRequestResponse() {
  return NextResponse.json({ error: "The request is invalid." }, { status: 400 });
}

export function oversizedRequestResponse() {
  return NextResponse.json({ error: "The request is too large." }, { status: 413 });
}
