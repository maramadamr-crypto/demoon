import { db } from './index.ts';
import { users, documents, reminders } from './schema.ts';
import { eq, and, desc } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email?: string, displayName?: string, photoURL?: string) {
  try {
    const result = await db.insert(users)
      .values({
        uid,
        email: email || '',
        displayName: displayName || 'طالب متميز',
        photoURL: photoURL || '',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: email || '',
          displayName: displayName || undefined,
          photoURL: photoURL || undefined,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error("Database user upsert note:", error);
    throw new Error("Failed to sync user in database", { cause: error });
  }
}

export async function getCloudDocuments() {
  try {
    return await db.select().from(documents).orderBy(desc(documents.createdAt));
  } catch (error) {
    console.error("Database query failed:", error);
    throw new Error("Database query failed. Please try again later.", { cause: error });
  }
}

export async function saveCloudDocument(docData: {
  id: string;
  userId: string;
  title: string;
  subject: string;
  customSubjectName?: string;
  docType?: string;
  format?: string;
  grade?: string;
  term?: string;
  author?: string;
  description?: string;
  pagesJson?: string;
  averageRating?: number;
  ratingsCount?: number;
}) {
  try {
    const safeRating = Math.min(5, Math.max(1, Math.round(Number(docData.averageRating ?? 5))));
    const safeCount = Math.max(0, Math.round(Number(docData.ratingsCount ?? 0)));
    const normalized = {
      ...docData,
      averageRating: safeRating,
      ratingsCount: safeCount,
    };
    const result = await db.insert(documents)
      .values(normalized)
      .onConflictDoUpdate({
        target: documents.id,
        set: {
          title: normalized.title,
          subject: normalized.subject,
          customSubjectName: normalized.customSubjectName,
          docType: normalized.docType,
          format: normalized.format,
          grade: normalized.grade,
          term: normalized.term,
          author: normalized.author,
          description: normalized.description,
          pagesJson: normalized.pagesJson,
          averageRating: safeRating,
          ratingsCount: safeCount,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error("Database save document error:", error);
    throw new Error("Failed to save document in database", { cause: error });
  }
}

export async function deleteCloudDocument(id: string, userId?: string) {
  try {
    const whereClause = userId
      ? and(eq(documents.id, id), eq(documents.userId, userId))
      : eq(documents.id, id);
    return await db.delete(documents).where(whereClause).returning();
  } catch (error) {
    console.error("Database delete document error:", error);
    throw new Error("Failed to delete document from database", { cause: error });
  }
}
