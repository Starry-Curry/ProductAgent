"""Photo-to-GLB generation; no business writes or cloud calls on import."""
from .service import GenerationError, generate_model

__all__ = ['GenerationError', 'generate_model']
