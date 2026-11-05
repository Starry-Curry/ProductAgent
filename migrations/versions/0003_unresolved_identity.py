"""Keep unresolved identities on their instance; never share an unknown model."""
import json
from alembic import op
import sqlalchemy as sa

revision='0003'
down_revision='0002'
branch_labels=None
depends_on=None

def upgrade():
    connection=op.get_bind()
    # Early v0.3 development artifacts predated nonstandard identity preservation.
    if 'identity_notes' not in {c['name'] for c in sa.inspect(connection).get_columns('items')}:
        op.add_column('items',sa.Column('identity_notes',sa.JSON(),nullable=False,server_default='{}'))
    for row in connection.execute(sa.text('SELECT items.id, items.kind, products.id AS product_id, products.spec FROM items JOIN products ON products.id=items.product_id')).mappings():
        spec=json.loads(row['spec']) if isinstance(row['spec'],str) else row['spec']
        if row['kind']=='standard_product' and spec.get('brand','').strip() and spec.get('model','').strip():
            continue
        connection.execute(sa.text('UPDATE items SET product_id=NULL, identity_notes=:spec WHERE id=:id'),
                           {'id':row['id'],'spec':json.dumps(spec,ensure_ascii=False)})
        connection.execute(sa.text("UPDATE knowledge_claims SET status='superseded' WHERE product_id=:product"),{'product':row['product_id']})
    # No user facts are deleted. Retain referenced historical product records.
    connection.execute(sa.text('DELETE FROM products WHERE NOT EXISTS (SELECT 1 FROM items WHERE items.product_id=products.id) AND NOT EXISTS (SELECT 1 FROM knowledge_claims WHERE knowledge_claims.product_id=products.id)'))

def downgrade():
    # Unresolved metadata remains losslessly available; no need to fabricate a shared model again.
    pass
