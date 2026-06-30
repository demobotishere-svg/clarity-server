import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, assessments } from "@/db/schema";
import { eq, ilike, and, gte, lte, desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "ALL";
    const priority = searchParams.get("priority") || "ALL";
    const payment = searchParams.get("payment") || "ALL";
    const lifecycle = searchParams.get("lifecycle") || "ALL";
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";

    const conditions = [];

    if (search) {
      conditions.push(ilike(leads.phone, `%${search}%`));
    }

    if (status !== "ALL") {
      conditions.push(eq(assessments.status, status as any));
    }

    if (priority !== "ALL") {
      if (priority === "HIGH") {
        conditions.push(gte(assessments.score, 80));
      } else if (priority === "MID") {
        conditions.push(and(gte(assessments.score, 50), lte(assessments.score, 79)));
      } else if (priority === "LOW") {
        conditions.push(lte(assessments.score, 49));
      } else if (priority === "UNSCORED") {
        conditions.push(sql`${assessments.score} IS NULL`);
      }
    }

    if (payment !== "ALL") {
      if (payment === "PAID") {
        conditions.push(eq(leads.hasPaid, true));
      } else if (payment === "UNPAID") {
        conditions.push(eq(leads.hasPaid, false));
      }
    }

    if (lifecycle !== "ALL") {
      if (lifecycle === "WEEK_1") {
        conditions.push(sql`EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) <= 7`);
      } else if (lifecycle === "WEEK_2") {
        conditions.push(sql`EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) > 7 AND EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) <= 14`);
      } else if (lifecycle === "WEEK_3") {
        conditions.push(sql`EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) > 14 AND EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) <= 21`);
      } else if (lifecycle === "WEEK_4") {
        conditions.push(sql`EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) > 21 AND EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) <= 28`);
      } else if (lifecycle === "EXPIRED") {
        conditions.push(sql`EXTRACT(DAY FROM CURRENT_TIMESTAMP - ${leads.createdAt}) > 28`);
      }
    }

    if (startDate) {
      conditions.push(gte(leads.updatedAt, new Date(`${startDate}T00:00:00.000Z`)));
    }
    if (endDate) {
      conditions.push(lte(leads.updatedAt, new Date(`${endDate}T23:59:59.999Z`)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch all matching records without limit/offset
    const fetchedData = await db.select()
      .from(leads)
      .leftJoin(assessments, eq(leads.id, assessments.leadId))
      .where(whereClause)
      .orderBy(desc(leads.updatedAt));

    if (fetchedData.length === 0) {
      return new NextResponse("No data found for the given filters.", { status: 404 });
    }

    // Prepare CSV data
    const headers = [
      "ID",
      "Name",
      "Phone",
      "Has Paid",
      "Assessment Status",
      "Score",
      "Priority",
      "Profession",
      "Summary",
      "Last Active"
    ];

    const escapeCSV = (val: any) => {
      if (val === null || val === undefined) return '""';
      const strVal = String(val);
      const escaped = strVal.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const csvRows = fetchedData.map(row => {
      const l = row.Lead;
      const a = row.Assessment;

      let priorityLabel = "UNSCORED";
      if (a && a.score !== null) {
        if (a.score >= 80) priorityLabel = "HIGH";
        else if (a.score >= 50) priorityLabel = "MID";
        else priorityLabel = "LOW";
      }

      const values = [
        l.id,
        l.name,
        l.phone,
        l.hasPaid,
        a?.status || "NO_ASSESSMENT",
        a?.score !== null ? a.score : "N/A",
        priorityLabel,
        a?.profession || "",
        a?.summary || "",
        new Date(a?.updatedAt || l.updatedAt).toISOString()
      ];

      return values.map(escapeCSV).join(",");
    });

    const csvContent = [headers.join(","), ...csvRows].join("\n");

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="leads_export_${new Date().toISOString().split('T')[0]}.csv"`
      }
    });

  } catch (error) {
    console.error("Export error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
