import asyncio
import sys
sys.path.insert(0, ".")

from src.database import get_db_connection
from src.database_migrations import run_migrations

async def main():
    async with get_db_connection() as db:
        await run_migrations(db)
    print("MIGRATION_SUCCESS")

if __name__ == "__main__":
    asyncio.run(main())
