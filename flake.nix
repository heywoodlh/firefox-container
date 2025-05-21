{
  description = "Flake for heywoodlh-firefox-container";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs =
    inputs@{
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        package = pkgs.writeShellScriptBin "package" ''
          ${pkgs.web-ext}/bin/web-ext build \
            --source-dir ${self} \
            --overwrite-dest
        '';
      in
      {
        devShell = pkgs.mkShell {
          name = "default";
          buildInputs = with pkgs; [
            web-ext
            package
          ];
        };

        formatter = pkgs.nixfmt-rfc-style;
      }
    );
}
