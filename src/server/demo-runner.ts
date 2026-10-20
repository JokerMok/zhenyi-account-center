import { appConfigs, config } from "./config";
import { pool, assert } from "./db";
import {
  createEntitlementClient,
  CenterRequestError,
} from "../../examples/product-client";
import { createHash } from "node:crypto";
export async function runDemoJob(
  appId: string,
  uid: string,
  input: { request_id: string; mode: string },
  token?: string,
  client = createEntitlementClient({
    centerUrl: config.CENTER_URL,
    productId: appId,
    serviceKey: appConfigs[appId].serviceKey,
  }),
) {
  const businessRequest =
    "demo_" +
    createHash("sha256")
      .update(appId + ":" + uid + ":" + input.request_id)
      .digest("hex");
  const db = await pool.connect(),
    key = `demo:${appId}:${uid}:${input.request_id}`;
  try {
    await db.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [key]);
    let job = (
      await db.query(
        "SELECT * FROM demo_jobs WHERE app_id=$1 AND uid=$2 AND request_id=$3",
        [appId, uid, input.request_id],
      )
    ).rows[0];
    const uncertainBefore = job?.stage === "pending_recovery";
    if (job) {
      assert(
        job.mode === input.mode,
        409,
        "IDEMPOTENCY_CONFLICT",
        "同一任务不能更换执行方式",
      );
      if (job.stage === "complete") return { ...job.result, repeated: true };
    } else {
      assert(token, 401, "LOGIN_REQUIRED", "新任务需要有效用户会话");
      job = (
        await db.query(
          "INSERT INTO demo_jobs(app_id,uid,request_id,mode,result,stage) VALUES($1,$2,$3,$4,'{}','pending') RETURNING *",
          [appId, uid, input.request_id, input.mode],
        )
      ).rows[0];
    }
    const save = async (stage: string, result: any) => {
      await db.query(
        "UPDATE demo_jobs SET stage=$4,result=$5,reservation_id=$6,updated_at=now() WHERE app_id=$1 AND uid=$2 AND request_id=$3",
        [appId, uid, input.request_id, stage, result, job.reservation_id],
      );
      return result;
    };
    try {
      let hold: any;
      try {
        hold = await client.status(
          job.reservation_id
            ? { reservation_id: job.reservation_id }
            : { request_id: businessRequest },
        );
      } catch (e) {
        if (
          !(e instanceof CenterRequestError) ||
          e.code !== "RESERVATION_NOT_FOUND"
        )
          throw e;
        if (!token)
          return await save("pending_recovery", {
            ok: false,
            status: "pending_recovery",
            request_id: job.request_id,
            message: "尚无法核实预占；等待原任务重新登录重试，不生成新请求号",
          });
        hold = await client.reserve(token, "export", businessRequest);
      }
      job.reservation_id = hold.id;
      await save("reserved", {
        ok: false,
        status: "pending_recovery",
        request_id: job.request_id,
        message: "任务处理中",
      });
      if (hold.status === "reserved") {
        if (input.mode === "fail_before" || !token) {
          try {
            hold = await client.recover(
              { reservation_id: hold.id },
              "cancel",
              input.mode === "fail_before"
                ? "示例任务生成前失败"
                : "用户会话不可用，释放尚未执行的任务",
            );
          } catch (e) {
            if (
              !(e instanceof CenterRequestError) ||
              e.code !== "INVALID_TRANSITION"
            )
              throw e;
            hold = await client.status({ reservation_id: hold.id });
          }
        } else {
          await save("confirming", {
            ok: false,
            status: "pending_recovery",
            request_id: job.request_id,
            message: "确认结果待核实",
          });
          hold = await client.confirmKnown(token, hold.id);
        }
      }
      if (hold.status === "confirmed" && input.mode !== "success")
        hold = await client.recover(
          { reservation_id: hold.id },
          "refund",
          "已确认扣次，但示例任务交付失败",
        );
      if (hold.status !== "confirmed") {
        if (["cancelled", "expired", "refunded"].includes(hold.status))
          return await save("complete", {
            ok: false,
            status: hold.status,
            request_id: job.request_id,
            message:
              hold.status === "refunded"
                ? "模拟交付失败，已返还消费次数"
                : "任务未交付，预占已释放",
          });
        return await save("pending_recovery", {
          ok: false,
          status: "pending_recovery",
          request_id: job.request_id,
          message: "中心记录尚未确认，任务保留待恢复",
        });
      }
      // The demo artifact is deterministic for the durable job, so recovery/retries cannot execute an extra paid task.
      const content =
        appId === "beadgrid"
          ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#f6f5f1"/><path d="M40 40h40v40H40zM80 80h40v40H80zM120 40h40v40h-40zM40 120h40v40H40zM120 120h40v40h-40z" fill="#236650"/></svg>'
          : JSON.stringify(
              {
                kind: "server-generated-demo",
                duration_seconds: 10,
                created_at: job.created_at,
                request_id: job.request_id,
              },
              null,
              2,
            );
      return await save("complete", {
        ok: true,
        status: "confirmed",
        request_id: job.request_id,
        message: "任务已在后端完成，消耗 1 次",
        artifact: {
          name:
            appId === "beadgrid" ? "beadgrid-pattern.svg" : "task-result.json",
          mime: appId === "beadgrid" ? "image/svg+xml" : "application/json",
          content,
          sha256: createHash("sha256").update(content).digest("hex"),
        },
      });
    } catch (error) {
      if (error instanceof CenterRequestError && error.outcome === "unknown")
        return await save("pending_recovery", {
          ok: false,
          status: "pending_recovery",
          request_id: job.request_id,
          message: "中心结果暂时未知，保留原任务等待恢复；请勿另开任务",
        });
      if (error instanceof CenterRequestError && error.outcome === "rejected") {
        if (!job.reservation_id && !uncertainBefore)
          return await save("complete", {
            ok: false,
            status: "rejected",
            code: error.code,
            request_id: job.request_id,
            message: error.message,
          });
        return await save("pending_recovery", {
          ok: false,
          status: "pending_recovery",
          code: error.code,
          request_id: job.request_id,
          message: "本次请求被拒绝，已有任务保留待后端核实",
        });
      }
      throw error;
    }
  } finally {
    try {
      await db.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        key,
      ]);
    } finally {
      db.release();
    }
  }
}
export async function recoverDemoJobs(appId: string) {
  const jobs = (
    await pool.query(
      "SELECT * FROM demo_jobs WHERE app_id=$1 AND stage<>'complete' ORDER BY created_at LIMIT 20",
      [appId],
    )
  ).rows;
  const results = [];
  for (const job of jobs) results.push(await runDemoJob(appId, job.uid, job));
  return results;
}
