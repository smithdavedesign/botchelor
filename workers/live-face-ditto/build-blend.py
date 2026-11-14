"""Builds Ditto's Cython blend extension in place (run from core/utils/blend) for a portable CPU target. Ditto's own
blend.pyxbld compiles with -march=native on first import, which ties the binary to the machine that built it: built
on GitHub's runner it crashed with "Illegal instruction" on Runpod's EPYC hosts. x86-64-v2 (SSE4.2) runs anywhere a
GPU host exists; the blend is a per-pixel loop and doesn't miss the wider vectors."""
import numpy as np
from Cython.Build import cythonize
from setuptools import Extension, setup

ext = Extension(
    "blend",
    sources=["blend.pyx", "blend_impl.c"],
    include_dirs=[np.get_include(), "."],
    extra_compile_args=["-O3", "-std=c99", "-march=x86-64-v2", "-ffast-math"],
)
setup(name="blend", ext_modules=cythonize([ext], language_level=3, quiet=True), script_args=["build_ext", "--inplace", "--quiet"])
