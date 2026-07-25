-- AlterTable
ALTER TABLE "NewsEvent" ADD CONSTRAINT "NewsEvent_date_url_key" UNIQUE ("date", "url");
