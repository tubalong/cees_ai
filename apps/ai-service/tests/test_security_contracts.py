from app.repositories.vector_store_repository import VectorSearchFilter


def test_vector_filter_requires_tenant_and_knowledge_base() -> None:
    filters = VectorSearchFilter(
        tenant_id="tenant-a",
        allowed_knowledge_base_ids=["kb-a"],
        allowed_document_ids=["doc-a"],
        permission_filters={"department_ids": ["department-a"]},
    )
    assert filters.tenant_id == "tenant-a"
    assert filters.allowed_knowledge_base_ids == ["kb-a"]