-- 权限码收敛：知识库 8 码收敛为 5 码（块 8 前置）
-- 1) 新增 read_all（查看当前租户全部知识库，只读），与 manage_all（写）分离；
-- 2) 删除与库内成员等级（READER/EDITOR/MANAGER）1:1 重叠的 4 个旧码：
--    update / delete / member.manage / document.manage；
-- 3) 旧码持有者不降权：写操作深度改由库内成员等级驱动，manage_all/read_all 不受影响。

-- DropForeignKey（main 合并带入的 schema drift 对齐）
ALTER TABLE "assignment_policies" DROP CONSTRAINT "assignment_policies_project_id_fkey";

-- AddForeignKey
ALTER TABLE "assignment_policies" ADD CONSTRAINT "assignment_policies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 1. 新增 read_all 权限行
INSERT INTO "permissions" ("id", "code", "name", "created_at", "updated_at")
SELECT gen_random_uuid(), 'knowledge_base.read_all', '查看当前租户全部知识库', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'knowledge_base.read_all');

-- 2. 回填：系统角色（tenant_admin）及已持 manage_all 的角色获得 read_all（manage_all 隐含读全部）
INSERT INTO "role_permissions" ("id", "tenant_id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), role."tenant_id", role."id", permission."id", CURRENT_TIMESTAMP
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."deleted_at" IS NULL
  AND permission."code" = 'knowledge_base.read_all'
  AND (
    role."is_system" = true
    OR EXISTS (
      SELECT 1
      FROM "role_permissions" AS rp
      JOIN "permissions" AS p ON p."id" = rp."permission_id"
      WHERE rp."role_id" = role."id" AND p."code" = 'knowledge_base.manage_all'
    )
  )
ON CONFLICT ("tenant_id", "role_id", "permission_id") DO NOTHING;

-- 3. 删除旧码的角色关联与权限行
DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "id" FROM "permissions"
  WHERE "code" IN (
    'knowledge_base.update',
    'knowledge_base.delete',
    'knowledge_base.member.manage',
    'knowledge_base.document.manage'
  )
);

DELETE FROM "permissions"
WHERE "code" IN (
  'knowledge_base.update',
  'knowledge_base.delete',
  'knowledge_base.member.manage',
  'knowledge_base.document.manage'
);
