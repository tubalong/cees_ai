CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Prisma creates the relational tables from schema.prisma. Add the HNSW index
-- after DocumentChunk is created and the production embedding dimension is fixed.
-- TODO: CREATE INDEX document_chunks_embedding_hnsw ON document_chunks
-- USING hnsw (embedding vector_cosine_ops);