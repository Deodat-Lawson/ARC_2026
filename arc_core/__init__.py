"""
A.R.C. (Autonomous Rescue Cluster) — Core Algorithm Package

An autonomous post-disaster rescue cluster system powered by Gemma 4.
Implements the "Octopus Brain" architecture: DecisionHubs (brain) coordinate
EdgeAgents (tentacles) in a decentralized, fault-tolerant rescue network.

Package layout
--------------
``arc_core.agents`` / ``arc_core.bridge`` / ``arc_core.communication`` /
``arc_core.interfaces`` / ``arc_core.perception`` / ``arc_core.scheduler`` /
``arc_core.state_machine`` — algorithm core.

``arc_core.simulation`` — scenario builders and ``timeline_generator`` CLI.

``arc_core.runners`` — end-to-end demo entrypoint
(``python -m arc_core.runners``).

``arc_core.tests`` — pytest suite (``pytest`` from repo root).

``arc_core.paths`` — ``REPO_ROOT``, default scenario/timeline paths.
"""

__version__ = "0.1.0"
