import 'dotenv/config';
import { db } from '../src/lib/db';
try {
  const requests = await db.contactRequest.findMany({
    where: { status: 'new' },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: { id: true, name: true, email: true, message: true, createdAt: true },
  });
  console.log(JSON.stringify(requests, null, 2));
} finally {
  await db.$disconnect();
}
